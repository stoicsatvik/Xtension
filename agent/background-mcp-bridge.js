import { LOCAL_EVIDENCE_KEYS } from "./export-policy.js";

const MCP_CONFIG_KEY = "xtension.mcp.v1";
const BRIDGE_ORIGIN = "http://127.0.0.1:43128";
let loopGeneration = 0;
let syncTimer = null;

async function getConfig() {
  const stored = await chrome.storage.local.get(MCP_CONFIG_KEY);
  const value = stored[MCP_CONFIG_KEY];
  if (!value?.enabled || typeof value.token !== "string" || !value.token.trim()) return null;
  return value;
}

async function buildSnapshot() {
  const entries = Object.entries(LOCAL_EVIDENCE_KEYS);
  const stored = await chrome.storage.local.get(entries.map(([, storageKey]) => storageKey));
  const snapshot = {};
  for (const [field, storageKey] of entries) snapshot[field] = stored[storageKey] ?? null;
  return snapshot;
}

async function bridgeFetch(path, config, options = {}) {
  const response = await fetch(`${BRIDGE_ORIGIN}${path}`, {
    ...options,
    cache: "no-store",
    headers: {
      ...(options.headers ?? {}),
      authorization: `Bearer ${config.token}`,
      "content-type": "application/json"
    }
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body?.error || `Local MCP bridge returned HTTP ${response.status}.`);
  return body;
}

async function syncNow(config = null) {
  const active = config ?? await getConfig();
  if (!active) return { connected: false, reason: "not-configured" };
  const snapshot = await buildSnapshot();
  const result = await bridgeFetch("/v1/sync", active, {
    method: "POST",
    body: JSON.stringify({ snapshot })
  });
  await chrome.storage.local.set({
    [MCP_CONFIG_KEY]: { ...active, lastSyncAt: Date.now(), lastError: null }
  });
  return { connected: true, ...(result.status ?? {}) };
}

async function saveVerdict(extensionId, verdict) {
  const storageKey = LOCAL_EVIDENCE_KEYS.preferences;
  const stored = await chrome.storage.local.get(storageKey);
  const preferences = stored[storageKey] ?? {};
  preferences[extensionId] = {
    ...(preferences[extensionId] ?? {}),
    verdict,
    updatedAt: Date.now(),
    source: "mcp"
  };
  await chrome.storage.local.set({ [storageKey]: preferences });
  return { ok: true, verdict };
}

async function sendWorker(message) {
  const response = await chrome.runtime.sendMessage(message);
  if (response?.error) throw new Error(response.error);
  return response;
}

async function executeCommand(command) {
  const payload = command?.payload ?? {};
  switch (command?.type) {
    case "set-verdict":
      if (!["essential", "optional", "unnecessary"].includes(payload.verdict)) {
        throw new Error("Unsupported verdict.");
      }
      return saveVerdict(payload.extensionId, payload.verdict);
    case "start-trial":
      return sendWorker({ type: "trial:start", extensionId: payload.extensionId, days: payload.days ?? 7 });
    case "restore-extension":
      return sendWorker({ type: "extension:enable", extensionId: payload.extensionId });
    case "uninstall-extension":
      return sendWorker({ type: "extension:uninstall", extensionId: payload.extensionId });
    default:
      throw new Error(`Unsupported MCP bridge command: ${command?.type ?? "unknown"}`);
  }
}

async function postCommandResult(config, command, result) {
  await bridgeFetch(`/v1/commands/${encodeURIComponent(command.id)}/result`, config, {
    method: "POST",
    body: JSON.stringify(result)
  });
}

async function pollLoop(generation) {
  while (generation === loopGeneration) {
    const config = await getConfig();
    if (!config) return;
    try {
      const payload = await bridgeFetch("/v1/commands?wait=20000", config);
      for (const command of payload.commands ?? []) {
        try {
          const value = await executeCommand(command);
          await postCommandResult(config, command, { ok: true, value });
        } catch (error) {
          await postCommandResult(config, command, {
            ok: false,
            error: error instanceof Error ? error.message : String(error)
          });
        }
      }
      if (payload.commands?.length) await syncNow(config);
    } catch (error) {
      await chrome.storage.local.set({
        [MCP_CONFIG_KEY]: {
          ...config,
          lastError: error instanceof Error ? error.message : String(error),
          lastErrorAt: Date.now()
        }
      });
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
  }
}

function startLoop() {
  loopGeneration += 1;
  const generation = loopGeneration;
  void syncNow().catch(() => {});
  void pollLoop(generation);
}

function scheduleSync() {
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => void syncNow().catch(() => {}), 250);
}

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local") return;
  if (changes[MCP_CONFIG_KEY]) {
    startLoop();
    return;
  }
  if (Object.values(LOCAL_EVIDENCE_KEYS).some((key) => changes[key])) scheduleSync();
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || typeof message !== "object" || !String(message.type ?? "").startsWith("mcp:")) return false;
  const respond = (promise) => {
    promise.then(sendResponse).catch((error) => sendResponse({ error: error?.message || String(error) }));
    return true;
  };

  if (message.type === "mcp:configure") {
    return respond((async () => {
      const token = String(message.token ?? "").trim();
      if (token.length < 32) throw new Error("Bridge token is invalid.");
      const config = { enabled: true, token, configuredAt: Date.now(), lastError: null };
      await chrome.storage.local.set({ [MCP_CONFIG_KEY]: config });
      return syncNow(config);
    })());
  }
  if (message.type === "mcp:disconnect") {
    return respond((async () => {
      loopGeneration += 1;
      await chrome.storage.local.remove(MCP_CONFIG_KEY);
      return { connected: false };
    })());
  }
  if (message.type === "mcp:sync") return respond(syncNow());
  if (message.type === "mcp:status") {
    return respond((async () => {
      const config = await getConfig();
      return config
        ? { configured: true, lastSyncAt: config.lastSyncAt ?? null, lastError: config.lastError ?? null }
        : { configured: false, lastSyncAt: null, lastError: null };
    })());
  }
  return false;
});

void getConfig().then((config) => {
  if (config) startLoop();
});
