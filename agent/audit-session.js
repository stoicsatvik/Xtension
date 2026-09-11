export const AUDIT_SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export function newAuditSession(now = Date.now()) {
  return {
    startedAt: now,
    decisions: 0,
    skippedIds: []
  };
}

export function normalizeAuditSession(value, validExtensionIds = [], now = Date.now()) {
  const validIds = new Set(validExtensionIds);
  if (!value || typeof value !== "object") return newAuditSession(now);

  const startedAt = Number(value.startedAt);
  if (!Number.isFinite(startedAt) || startedAt <= 0 || now - startedAt > AUDIT_SESSION_MAX_AGE_MS) {
    return newAuditSession(now);
  }

  const decisions = Number.isFinite(Number(value.decisions))
    ? Math.max(0, Math.floor(Number(value.decisions)))
    : 0;
  const skippedIds = Array.isArray(value.skippedIds)
    ? [...new Set(value.skippedIds.filter((id) => typeof id === "string" && validIds.has(id)))]
    : [];

  return { startedAt, decisions, skippedIds };
}

export function serializeAuditSession({ startedAt, decisions, skipped }) {
  return {
    startedAt: Number.isFinite(startedAt) ? startedAt : Date.now(),
    decisions: Number.isFinite(decisions) ? Math.max(0, Math.floor(decisions)) : 0,
    skippedIds: [...new Set(skipped instanceof Set ? [...skipped] : [])]
  };
}
