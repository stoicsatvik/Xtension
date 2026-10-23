// Local, single-use consent contract for MCP commands that change Chrome state.
// No remote MCP client may mint or approve these records.
export const MCP_APPROVALS_KEY = "xtension.mcp.approvals.v1";
export const MCP_APPROVAL_TTL_MS = 5 * 60 * 1000;
const MUTATING_TYPES = new Set(["start-trial", "restore-extension", "uninstall-extension"]);

export function requiresMcpApproval(type) {
  return MUTATING_TYPES.has(type);
}

export function approvalFingerprint(command) {
  const id = String(command?.id ?? "");
  const type = String(command?.type ?? "");
  const extensionId = String(command?.payload?.extensionId ?? "");
  if (!id || !requiresMcpApproval(type) || !/^[a-p]{32}$/.test(extensionId)) {
    throw new Error("Invalid local MCP approval request.");
  }
  const days = type === "start-trial" ? (command.payload?.days ?? 7) : null;
  if (days !== null && (!Number.isInteger(days) || days < 1 || days > 30)) {
    throw new Error("Invalid trial duration.");
  }
  return JSON.stringify([id, type, extensionId, days]);
}

export function pendingMcpApproval(command, now = Date.now()) {
  const fingerprint = approvalFingerprint(command);
  return {
    id: String(command.id),
    type: command.type,
    extensionId: command.payload.extensionId,
    days: command.type === "start-trial" ? (command.payload.days ?? 7) : null,
    fingerprint,
    status: "pending",
    createdAt: now,
    expiresAt: now + MCP_APPROVAL_TTL_MS
  };
}

export function approvalState(records, command, now = Date.now()) {
  const record = records?.[String(command?.id ?? "")];
  if (!record) return "missing";
  if (record.fingerprint !== approvalFingerprint(command)) return "mismatch";
  if (!Number.isFinite(record.expiresAt) || now >= record.expiresAt) return "expired";
  return ["pending", "approved", "denied", "consumed"].includes(record.status)
    ? record.status : "mismatch";
}

export function decideMcpApproval(records, id, decision, now = Date.now()) {
  if (!["approved", "denied"].includes(decision)) throw new Error("Invalid approval decision.");
  const record = records?.[id];
  if (!record || record.status !== "pending" || now >= record.expiresAt) {
    throw new Error("Approval is absent, expired, or already decided.");
  }
  return { ...records, [id]: { ...record, status: decision, decidedAt: now } };
}

export function consumeMcpApproval(records, id, now = Date.now()) {
  const record = records?.[id];
  if (!record || record.status !== "approved" || now >= record.expiresAt) {
    throw new Error("A fresh explicit approval is required.");
  }
  return { ...records, [id]: { ...record, status: "consumed", consumedAt: now } };
}
