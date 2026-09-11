export const LOCAL_EVIDENCE_KEYS = Object.freeze({
  inventory: "xtension.inventory.v1",
  trials: "xtension.trials.v1",
  preferences: "xtension.preferences.v1",
  alerts: "xtension.alerts.v1",
  timeline: "xtension.timeline.v1",
  versionHistory: "xtension.version-history.v1",
  removedExtensions: "xtension.removed.v1",
  auditSession: "xtension.audit.session.v1"
});

export function buildLocalEvidenceExport(stored = {}, exportedAt = new Date().toISOString()) {
  const payload = {
    schema: "xtension-local-export-v2",
    exportedAt,
    privacy: {
      localFirst: true,
      rawBrowsingHistoryIncluded: false,
      note: "This export contains Xtension's local extension evidence only. Raw browsing history is not included."
    }
  };

  for (const [field, storageKey] of Object.entries(LOCAL_EVIDENCE_KEYS)) {
    payload[field] = stored[storageKey] ?? null;
  }

  return payload;
}
