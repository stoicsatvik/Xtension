import crypto from "node:crypto";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";

const DEFAULT_PORT = 43128;
const MAX_BODY_BYTES = 2 * 1024 * 1024;
const DEFAULT_COMMAND_LEASE_MS = 30_000;
const DEFAULT_DEDUPE_WINDOW_MS = 60_000;
const STATE_DIR = path.join(os.homedir(), ".xtension");
const TOKEN_PATH = path.join(STATE_DIR, "bridge-token");
const STATE_PATH = path.join(STATE_DIR, "state.json");
const SAFE_TOP_LEVEL_KEYS = new Set([
  "inventory",
  "trials",
  "preferences",
  "alerts",
  "timeline",
  "versionHistory",
  "removedExtensions",
  "auditSession"
]);

function json(res, status, value) {
  const body = JSON.stringify(value);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store"
  });
  res.end(body);
}

async function readBody(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new Error("Request body exceeds Xtension's local bridge limit.");
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function sanitizeSnapshot(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Snapshot must be a JSON object.");
  }
  const sanitized = {};
  for (const [key, value] of Object.entries(input)) {
    if (SAFE_TOP_LEVEL_KEYS.has(key)) sanitized[key] = value;
  }
  return sanitized;
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
  }
  return value;
}

// A cached action result is valid only for the observed extension state.
// Exclude inventory timestamps and unrelated evidence updates: they do not
// change whether a browser-state mutation should be retried.
function commandStateFingerprint(snapshot) {
  const extensions = Array.isArray(snapshot?.inventory?.extensions)
    ? snapshot.inventory.extensions
      .map((item) => ({ id: item.id, enabled: item.enabled }))
      .sort((a, b) => String(a.id).localeCompare(String(b.id)))
    : null;
  return JSON.stringify(stableValue({
    extensions,
    trials: snapshot?.trials ?? null,
    preferences: snapshot?.preferences ?? null,
    removedExtensions: snapshot?.removedExtensions ?? null
  }));
}

function commandFingerprint(type, payload) {
  return JSON.stringify([type, stableValue(payload)]);
}

function publicCommand(command) {
  return {
    id: command.id,
    type: command.type,
    payload: command.payload,
    createdAt: command.createdAt
  };
}

export async function ensureBridgeToken() {
  await fs.mkdir(STATE_DIR, { recursive: true, mode: 0o700 });
  const fromEnv = process.env.XTENSION_BRIDGE_TOKEN?.trim();
  if (fromEnv) return fromEnv;

  try {
    const existing = (await fs.readFile(TOKEN_PATH, "utf8")).trim();
    if (existing) return existing;
  } catch {}

  const token = crypto.randomBytes(32).toString("hex");
  await fs.writeFile(TOKEN_PATH, `${token}\n`, { mode: 0o600 });
  return token;
}

export async function readPersistedState() {
  let contents;
  try {
    contents = await fs.readFile(STATE_PATH, "utf8");
  } catch (error) {
    // A missing file is a legitimate first run. Permission or I/O failures
    // must not be mistaken for a fresh installation.
    if (error?.code === "ENOENT") return { lastSyncAt: 0, snapshot: {} };
    throw new Error("Cannot read Xtension persisted state; refusing to reset it.", { cause: error });
  }

  try {
    const parsed = JSON.parse(contents);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("Persisted state root must be a JSON object.");
    }
    // Persisted generation identifiers prevent ABA: a stale process must
    // not accept A -> B -> A merely because the logical JSON looks identical.
    // Keep this metadata non-enumerable in the public read result to preserve
    // the existing state shape for callers and legacy persisted files.
    const revisionId = Object.hasOwn(parsed, "revisionId") ? parsed.revisionId : null;
    if (revisionId !== null && (typeof revisionId !== "string" || !revisionId)) {
      throw new Error("Persisted revisionId must be a nonempty string.");
    }
    const state = {
      lastSyncAt: Number(parsed.lastSyncAt) || 0,
      snapshot: sanitizeSnapshot(parsed.snapshot ?? {})
    };
    Object.defineProperty(state, "revisionId", { value: revisionId, enumerable: false });
    return state;
  } catch (error) {
    // Fail closed: silently replacing a corrupt state with an empty one
    // would let the next /v1/sync overwrite the only surviving evidence.
    throw new Error("Invalid Xtension persisted state; refusing to overwrite corrupt data.", { cause: error });
  }
}

function stateConflict(message) {
  const error = new Error(message);
  error.code = "XTENSION_STATE_CONFLICT";
  return error;
}

// Atomic directory creation gives participating bridge processes a shared
// exclusion point. A stale lock is intentionally NOT broken automatically:
// crash recovery requires verifying no writer is alive before manual removal.
async function persistState(revision, expectedRevision) {
  await fs.mkdir(STATE_DIR, { recursive: true, mode: 0o700 });
  const lockDir = `${STATE_PATH}.lock`;
  try {
    await fs.mkdir(lockDir, { mode: 0o700 });
  } catch (error) {
    if (error?.code === "EEXIST") {
      throw stateConflict("Another Xtension bridge holds the state write lock; refusing a concurrent write.");
    }
    throw error;
  }

  const tmp = `${STATE_PATH}.${process.pid}.tmp`;
  try {
    // Both the check and rename must happen while holding the same lock.
    // Comparing the full revision also catches equal-timestamp conflicts.
    const current = await readPersistedState();
    if ((current.revisionId ?? null) !== (expectedRevision.revisionId ?? null) ||
        JSON.stringify({ lastSyncAt: current.lastSyncAt, snapshot: current.snapshot }) !==
        JSON.stringify({ lastSyncAt: expectedRevision.lastSyncAt, snapshot: expectedRevision.snapshot })) {
      throw stateConflict("Xtension persisted state changed in another process; refusing stale overwrite. Restart the bridge to reload.");
    }
    await fs.writeFile(tmp, JSON.stringify(revision, null, 2), { mode: 0o600 });
    await fs.rename(tmp, STATE_PATH);
  } finally {
    await fs.rm(tmp, { force: true }).catch(() => {});
    await fs.rmdir(lockDir);
  }
}

export function createBridgeStore({
  token,
  initialState,
  now = () => Date.now(),
  commandLeaseMs = DEFAULT_COMMAND_LEASE_MS,
  dedupeWindowMs = DEFAULT_DEDUPE_WINDOW_MS,
  persistSnapshot = persistState
}) {
  const state = {
    lastSyncAt: initialState?.lastSyncAt ?? 0,
    // Readers must never share mutable references with the caller.
    snapshot: structuredClone(initialState?.snapshot ?? {})
  };
  const commands = [];
  const waiters = new Map();
  const completedByFingerprint = new Map();
  const completedIds = new Map();
  // Keep on-disk revisions ordered even when two /v1/sync requests overlap.
  let persistQueue = Promise.resolve();
  // Expected on-disk revision advances only after a successful write.
  // Independent processes therefore cannot silently replace each other's data.
  let lastPersistedRevision = {
    lastSyncAt: state.lastSyncAt,
    snapshot: structuredClone(state.snapshot),
    revisionId: initialState?.revisionId ?? null
  };
  let lastCommandState = commandStateFingerprint(state.snapshot);

  function pruneCompleted() {
    const cutoff = now() - dedupeWindowMs;
    for (const [fingerprint, entry] of completedByFingerprint) {
      if (entry.completedAt < cutoff) completedByFingerprint.delete(fingerprint);
    }
    for (const [id, completedAt] of completedIds) {
      if (completedAt < cutoff) completedIds.delete(id);
    }
  }

  function compactStatus() {
    pruneCompleted();
    const inventoryCount = state.snapshot?.inventory?.extensions?.length ?? 0;
    return {
      connected: Boolean(state.lastSyncAt),
      lastSyncAt: state.lastSyncAt || null,
      inventoryCount,
      queuedCommands: commands.length
    };
  }

  function waitForResult(command, timeoutMs) {
    const existing = waiters.get(command.id);
    if (existing) return existing.promise;

    let resolvePromise;
    let rejectPromise;
    const promise = new Promise((resolve, reject) => {
      resolvePromise = resolve;
      rejectPromise = reject;
    });
    const timer = setTimeout(() => {
      const current = waiters.get(command.id);
      if (current?.promise === promise) waiters.delete(command.id);
      rejectPromise(new Error("Xtension agent did not answer the command in time. The command remains queued safely; retrying the same action will not create a duplicate."));
    }, timeoutMs);
    waiters.set(command.id, {
      promise,
      resolve: (value) => {
        clearTimeout(timer);
        resolvePromise(value);
      }
    });
    return promise;
  }

  function enqueueCommand(type, payload = {}, timeoutMs = 40_000) {
    pruneCompleted();
    const fingerprint = commandFingerprint(type, payload);
    const cached = completedByFingerprint.get(fingerprint);
    if (cached) return Promise.resolve(cached.result);

    let command = commands.find((item) => item.fingerprint === fingerprint);
    if (!command) {
      command = {
        id: crypto.randomUUID(),
        type,
        payload,
        createdAt: now(),
        leaseUntil: 0,
        fingerprint
      };
      commands.push(command);
    }
    return waitForResult(command, timeoutMs);
  }

  function completeCommand(id, result) {
    pruneCompleted();
    const index = commands.findIndex((command) => command.id === id);
    if (index < 0) return completedIds.has(id);

    const [command] = commands.splice(index, 1);
    const completedAt = now();
    // A transient failure must not suppress a legitimate retry for a minute.
    if (result?.ok !== false) completedByFingerprint.set(command.fingerprint, { result, completedAt });
    completedIds.set(id, completedAt);

    const waiter = waiters.get(id);
    if (waiter) {
      waiters.delete(id);
      waiter.resolve(result);
    }
    return true;
  }

  function leaseAvailable(limit = 20) {
    const leased = [];
    const leasedUntil = now() + commandLeaseMs;
    for (const command of commands) {
      if (leased.length >= Math.max(1, Math.min(limit, 20))) break;
      if ((command.leaseUntil ?? 0) > now()) continue;
      command.leaseUntil = leasedUntil;
      leased.push(publicCommand(command));
    }
    return leased;
  }

  async function waitForCommands(waitMs = 0) {
    const deadline = now() + Math.max(0, Math.min(waitMs, 25_000));
    let available = leaseAvailable();
    while (!available.length && now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 150));
      available = leaseAvailable();
    }
    return available;
  }

  return {
    state,
    commands,
    compactStatus,
    enqueueCommand,
    completeCommand,
    waitForCommands,
    async updateSnapshot(snapshot) {
      const sanitized = sanitizeSnapshot(snapshot);
      // Acceptance captures a private revision, but must not publish it.
      // MCP readers and /health expose only the latest successful disk write.
      const revision = {
        lastSyncAt: now(),
        snapshot: structuredClone(sanitized),
        revisionId: crypto.randomUUID()
      };
      const write = persistQueue.then(async () => {
        await persistSnapshot(revision, lastPersistedRevision);
        // Commit the visible revision only after persistence succeeds.
        // Queued writes remain serialized, so each successful revision is
        // published in order, even when a later write is still pending.
        lastPersistedRevision = structuredClone(revision);
        state.snapshot = structuredClone(revision.snapshot);
        state.lastSyncAt = revision.lastSyncAt;
        const nextCommandState = commandStateFingerprint(state.snapshot);
        if (nextCommandState !== lastCommandState) {
          // Invalidate cached actions at commit, not at tentative acceptance.
          completedByFingerprint.clear();
          lastCommandState = nextCommandState;
        }
      });
      // A failed disk write must not poison the queue or visible evidence.
      persistQueue = write.catch(() => {});
      await write;
      return compactStatus();
    },
    takeCommands(limit = 20) {
      return leaseAvailable(limit);
    },
    token
  };
}

export function startLocalBridge(store, { port = Number(process.env.XTENSION_BRIDGE_PORT) || DEFAULT_PORT } = {}) {
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "127.0.0.1"}`);

      if (req.method === "GET" && url.pathname === "/health") {
        return json(res, 200, { ok: true, ...store.compactStatus() });
      }

      const auth = req.headers.authorization ?? "";
      if (auth !== `Bearer ${store.token}`) return json(res, 401, { error: "Unauthorized local bridge request." });

      if (req.method === "POST" && url.pathname === "/v1/sync") {
        const body = await readBody(req);
        const status = await store.updateSnapshot(body.snapshot ?? body);
        return json(res, 200, { ok: true, status });
      }

      if (req.method === "GET" && url.pathname === "/v1/commands") {
        const waitMs = Number(url.searchParams.get("wait") ?? 0);
        return json(res, 200, { commands: await store.waitForCommands(waitMs) });
      }

      const resultMatch = url.pathname.match(/^\/v1\/commands\/([^/]+)\/result$/);
      if (req.method === "POST" && resultMatch) {
        const body = await readBody(req);
        const accepted = store.completeCommand(resultMatch[1], body);
        return json(res, accepted ? 200 : 404, accepted ? { ok: true } : { error: "Unknown command." });
      }

      return json(res, 404, { error: "Not found." });
    } catch (error) {
      return json(res, error?.code === "XTENSION_STATE_CONFLICT" ? 409 : 400, {
        error: error instanceof Error ? error.message : String(error)
      });
    }
  });

  server.listen(port, "127.0.0.1");
  return { server, port };
}

export const bridgePaths = { stateDir: STATE_DIR, tokenPath: TOKEN_PATH, statePath: STATE_PATH };
