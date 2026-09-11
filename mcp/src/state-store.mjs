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
  try {
    const parsed = JSON.parse(await fs.readFile(STATE_PATH, "utf8"));
    return {
      lastSyncAt: Number(parsed.lastSyncAt) || 0,
      snapshot: sanitizeSnapshot(parsed.snapshot ?? {})
    };
  } catch {
    return { lastSyncAt: 0, snapshot: {} };
  }
}

async function persistState(state) {
  await fs.mkdir(STATE_DIR, { recursive: true, mode: 0o700 });
  const tmp = `${STATE_PATH}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(state, null, 2), { mode: 0o600 });
  await fs.rename(tmp, STATE_PATH);
}

export function createBridgeStore({
  token,
  initialState,
  now = () => Date.now(),
  commandLeaseMs = DEFAULT_COMMAND_LEASE_MS,
  dedupeWindowMs = DEFAULT_DEDUPE_WINDOW_MS
}) {
  const state = {
    lastSyncAt: initialState?.lastSyncAt ?? 0,
    snapshot: initialState?.snapshot ?? {}
  };
  const commands = [];
  const waiters = new Map();
  const completedByFingerprint = new Map();
  const completedIds = new Map();

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
    completedByFingerprint.set(command.fingerprint, { result, completedAt });
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
      state.snapshot = sanitizeSnapshot(snapshot);
      state.lastSyncAt = now();
      await persistState(state);
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
      return json(res, 400, { error: error instanceof Error ? error.message : String(error) });
    }
  });

  server.listen(port, "127.0.0.1");
  return { server, port };
}

export const bridgePaths = { stateDir: STATE_DIR, tokenPath: TOKEN_PATH, statePath: STATE_PATH };
