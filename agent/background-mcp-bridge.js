import { LOCAL_EVIDENCE_KEYS } from "./export-policy.js";
import {
  MCP_APPROVALS_KEY, approvalState, consumeMcpApproval, decideMcpApproval,
  pendingMcpApproval, requiresMcpApproval
} from "./mcp-approval-policy.js";
import {
  findCommandResult,
  MCP_COMMAND_RESULTS_KEY,
  rememberCommandResult
} from "./mcp-command-cache.js";

const MCP_CONFIG_KEY = "xtension.mcp.v1";
const BRIDGE_ORIGIN = "http://127.0.0.1:43128";
let loopGeneration = 0;
let syncTimer = null;
const commandsInFlight = new Set();

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

async function readCachedCommandResult(commandId) {
  const stored = await chrome.storage.local.get(MCP_COMMAND_RESULTS_KEY);
  return findCommandResult(stored[MCP_COMMAND_RESULTS_KEY], commandId);
}

async function persistCommandResult(commandId, result) {
  const stored = await chrome.storage.local.get(MCP_COMMAND_RESULTS_KEY);
  const next = rememberCommandResult(stored[MCP_COMMAND_RESULTS_KEY], commandId, result);
  await chrome.storage.local.set({ [MCP_COMMAND_RESULTS_KEY]: next });
}

async function readApprovals() {
  const stored = await chrome.storage.local.get(MCP_APPROVALS_KEY);
  const records = stored[MCP_APPROVALS_KEY];
  return records && typeof records === "object" && !Array.isArray(records) ? records : {};
}

async function saveApprovals(records) {
  await chrome.storage.local.set({ [MCP_APPROVALS_KEY]: records });
}

async function checkLocalApproval(command) {
  const records = await readApprovals();
  const state = approvalState(records, command);
  if (state === "missing") {
    // Keep the command leased in the local MCP queue until the user explicitly
    // approves or denies it from the extension's own dashboard.
    const pending = pendingMcpApproval(command);
    const bounded = Object.fromEntries(
      Object.entries({ ...records, [command.id]: pending })
        .sort((a, b) => (b[1]?.createdAt ?? 0) - (a[1]?.createdAt ?? 0))
        .slice(0, 100)
    );
    await saveApprovals(bounded);
    return "pending";
  }
  if (state === "approved") {
    // Consume *before* changing Chrome state. A crash can lose the operation,
    // but cannot silently repeat a destructive operation after restart.
    await saveApprovals(consumeMcpApproval(records, command.id));
    return "approved";
  }
  return state;
}

export async function executeCommandOnce(command) {
  if (commandsInFlight.has(command.id)) return null;
  commandsInFlight.add(command.id);
  try {
    return await executeCommandOnceLocked(command);
  } finally {
    commandsInFlight.delete(command.id);
  }
}

async function executeCommandOnceLocked(command) {
  const cached = await readCachedCommandResult(command.id);
  if (cached) return cached;

  let result;
  try {
    if (requiresMcpApproval(command.type)) {
      const state = await checkLocalApproval(command);
      if (state === "pending") return null;
      if (state !== "approved") {
        throw new Error(state === "denied"
          ? "Xtension action denied by the local user."
          : "Xtension action requires a fresh local approval (expired, changed, or consumed).");
      }
    }
    const value = await executeCommand(command);
    result = { ok: true, value };
  } catch (error) {
    result = {
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }

  // Persist before acknowledging the MCP process. If Chrome or the bridge dies
  // after the browser action but before the POST succeeds, redelivery replays
  // this result instead of repeating the browser action.
  await persistCommandResult(command.id, result);
  return result;
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
        const result = await executeCommandOnce(command);
        if (result !== null) await postCommandResult(config, command, result);
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
    const previous = changes[MCP_CONFIG_KEY].oldValue;
    const next = changes[MCP_CONFIG_KEY].newValue;
    // A successful sync and an error report update metadata in this object.
    // Only pairing/enablement changes should replace the polling generation.
    const enabledChanged = Boolean(previous?.enabled) !== Boolean(next?.enabled);
    const tokenChanged = Boolean(next?.enabled) && previous?.token !== next?.token;
    if (enabledChanged || tokenChanged) startLoop();
    return;
  }
  if (Object.values(LOCAL_EVIDENCE_KEYS).some((key) => changes[key])) scheduleSync();
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
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
      await chrome.storage.local.remove([MCP_CONFIG_KEY, MCP_APPROVALS_KEY]);
      return { connected: false };
    })());
  }
  if (message.type === "mcp:sync") return respond(syncNow());
  if (message.type === "mcp:approvals") {
    return respond((async () => Object.values(await readApprovals())
      .filter((item) => item.status === "pending" && item.expiresAt > Date.now())
      .map(({ id, type, extensionId, days, expiresAt }) =>
        ({ id, type, extensionId, days, expiresAt })))());
  }
  if (message.type === "mcp:approve" || message.type === "mcp:deny") {
    return respond((async () => {
      // A remote MCP client can enqueue a request but cannot approve it.
      if (sender.id !== chrome.runtime.id || sender.url !== chrome.runtime.getURL("dashboard.html")) {
        throw new Error("Only the local Xtension dashboard can approve MCP actions.");
      }
      const id = String(message.commandId ?? "");
      const records = await readApprovals();
      const decision = message.type === "mcp:approve" ? "approved" : "denied";
      await saveApprovals(decideMcpApproval(records, id, decision));
      return { ok: true, id, decision };
    })());
  }
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
