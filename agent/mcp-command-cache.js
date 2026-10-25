export const MCP_COMMAND_RESULTS_KEY = "xtension.mcp.command-results.v1";
export const MAX_MCP_COMMAND_RESULTS = 100;

export function findCommandResult(records, commandId) {
  if (!Array.isArray(records) || !commandId) return null;
  return records.find((entry) => entry?.id === commandId)?.result ?? null;
}

// A command ID is not sufficient proof of replay identity. Persisted receipts
// must match both the command payload and the pairing that produced them.
export function inspectCommandReplay(records, commandId, fingerprint) {
  const entry = Array.isArray(records)
    ? records.find((record) => record?.id === commandId) : null;
  if (!entry) return { state: "missing" };
  if (typeof entry.fingerprint !== "string") return { state: "legacy" };
  if (entry.fingerprint !== fingerprint) return { state: "collision" };
  // A crash after a side effect but before its completion receipt leaves an
  // uncertain intent. Never infer that the browser action did not happen.
  if (entry.phase === "pending" || !Object.hasOwn(entry, "result")) {
    return { state: "pending" };
  }
  return { state: "replay", result: entry.result };
}

// Pending intents must never be evicted by newer completed receipts.
// When all slots are pending, reject new work instead of silently forgetting
// a possibly committed browser mutation.
function retainPending(entries, limit) {
  const maximum = Math.max(1, limit);
  const pendingCount = entries.filter((entry) => entry?.phase === "pending").length;
  if (pendingCount > maximum) {
    throw new Error("MCP command intent journal is full; reconcile pending commands.");
  }
  let completedSlots = maximum - pendingCount;
  return entries.filter((entry) => {
    if (entry?.phase === "pending") return true;
    if (completedSlots === 0) return false;
    completedSlots -= 1;
    return true;
  });
}

export function rememberCommandIntent(
  records, commandId, fingerprint, startedAt = Date.now(),
  limit = MAX_MCP_COMMAND_RESULTS
) {
  if (typeof fingerprint !== "string" || !fingerprint) {
    throw new Error("Cannot journal a command without a replay fingerprint.");
  }
  const existing = Array.isArray(records) ? records : [];
  const next = [
    { id: commandId, fingerprint, phase: "pending", startedAt },
    ...existing.filter((record) => record?.id !== commandId)
  ];
  return retainPending(next, limit);
}

export function rememberCommandResult(
  records, commandId, result, completedAt = Date.now(),
  limit = MAX_MCP_COMMAND_RESULTS, fingerprint = null
) {
  const existing = Array.isArray(records) ? records : [];
  const entry = { id: commandId, result, completedAt };
  if (fingerprint !== null) {
    entry.fingerprint = fingerprint;
    entry.phase = "completed";
  }
  const next = [
    entry,
    ...existing.filter((record) => record?.id !== commandId)
  ];
  return retainPending(next, limit);
}
