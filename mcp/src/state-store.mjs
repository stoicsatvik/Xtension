import crypto from "node:crypto";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";

const DEFAULT_PORT = 43128;
const MAX_BODY_BYTES = 2 * 1024 * 1024;
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

export function createBridgeStore({ token, initialState }) {
  const state = {
    lastSyncAt: initialState?.lastSyncAt ?? 0,
    snapshot: initialState?.snapshot ?? {}
  };
  const commands = [];
  const waiters = new Map();

  function compactStatus() {
    const inventoryCount = state.snapshot?.inventory?.extensions?.length ?? 0;
    return {
      connected: Boolean(state.lastSyncAt),
      lastSyncAt: state.lastSyncAt || null,
      inventoryCount,
      queuedCommands: commands.length
    };
  }

  function enqueueCommand(type, payload = {}, timeoutMs = 15_000) {
    const id = crypto.randomUUID();
    const command = { id, type, payload, createdAt: Date.now() };
    commands.push(command);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        waiters.delete(id);
        reject(new Error("Xtension agent did not answer the command in time. Open Chrome and ensure the local bridge is connected."));
      }, timeoutMs);
      waiters.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        }
      });
    });
  }

  function completeCommand(id, result) {
    const waiter = waiters.get(id);
    if (!waiter) return false;
    waiters.delete(id);
    waiter.resolve(result);
    return true;
  }

  return {
    state,
    commands,
    compactStatus,
    enqueueCommand,
    completeCommand,
    async updateSnapshot(snapshot) {
      state.snapshot = sanitizeSnapshot(snapshot);
      state.lastSyncAt = Date.now();
      await persistState(state);
      return compactStatus();
    },
    takeCommands(limit = 20) {
      return commands.splice(0, Math.max(1, Math.min(limit, 20)));
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
        return json(res, 200, { commands: store.takeCommands() });
      }

      const resultMatch = url.pathname.match(/^\/v1\/commands\/([^/]+)\/result$/);
      if (req.method === "POST" && resultMatch) {
        const body = await readBody(req);
        const accepted = store.completeCommand(resultMatch[1], body);
        return json(res, accepted ? 200 : 404, accepted ? { ok: true } : { error: "Unknown or expired command." });
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
