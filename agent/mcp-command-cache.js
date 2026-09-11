export const MCP_COMMAND_RESULTS_KEY = "xtension.mcp.command-results.v1";
export const MAX_MCP_COMMAND_RESULTS = 100;

export function findCommandResult(records, commandId) {
  if (!Array.isArray(records) || !commandId) return null;
  return records.find((entry) => entry?.id === commandId)?.result ?? null;
}

export function rememberCommandResult(records, commandId, result, completedAt = Date.now(), limit = MAX_MCP_COMMAND_RESULTS) {
  const existing = Array.isArray(records) ? records : [];
  const next = [
    { id: commandId, result, completedAt },
    ...existing.filter((entry) => entry?.id !== commandId)
  ];
  return next.slice(0, Math.max(1, limit));
}
