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
  return { state: "replay", result: entry.result };
}

export function rememberCommandResult(
  records, commandId, result, completedAt = Date.now(),
  limit = MAX_MCP_COMMAND_RESULTS, fingerprint = null
) {
  const existing = Array.isArray(records) ? records : [];
  const entry = { id: commandId, result, completedAt };
  if (fingerprint !== null) entry.fingerprint = fingerprint;
  const next = [
    entry,
    ...existing.filter((record) => record?.id !== commandId)
  ];
  return next.slice(0, Math.max(1, limit));
}
