// Keep raw Chrome browsing history local. An approved storage key is not
// permission to export arbitrary nested URLs or browser visit metadata.
// Ambiguous generic URLs fail closed; declared extension metadata URLs such
// as homepageUrl and optionsUrl remain permitted.
const HISTORY_FIELDS = new Set([
  "history", "rawhistory", "rawbrowsinghistory", "browsinghistory",
  "browserhistory", "historyurls", "visitedurls", "visitedpages",
  "recentpages", "recentvisits", "historyentries", "historyitems",
  "recentlyvisitedurls", "visitedsites", "historyvisits"
]);
const HISTORY_RECORD_FIELDS = new Set([
  "lastvisittime", "visitcount", "typedcount", "referringvisitid", "transition",
  "visittime", "visitedat", "lastvisitedat", "firstvisittime", "visitid",
  "lastvisited", "visitduration"
]);
const AMBIGUOUS_BROWSING_URL_FIELDS = new Set([
  "url", "href", "pageurl", "pagehref", "taburl", "documenturl",
  "locationhref", "referrerurl", "referrer", "referer", "visitedurl",
  "currenturl", "lasturl"
]);
const keyName = (key) => key.toLowerCase().replace(/[^a-z0-9]/g, "");

export function assertNoRawBrowsingHistory(value, depth = 0) {
  if (depth > 32) throw new Error("Evidence nesting exceeds the privacy validation limit.");
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) assertNoRawBrowsingHistory(item, depth + 1);
    return;
  }
  const keys = Object.keys(value);
  if (keys.some((key) => HISTORY_FIELDS.has(keyName(key)))) {
    throw new Error("Raw browsing-history field cannot leave the local agent.");
  }
  if (keys.some((key) => HISTORY_RECORD_FIELDS.has(keyName(key)))) {
    throw new Error("Browser visit metadata cannot leave the local agent.");
  }
  if (keys.some((key) => AMBIGUOUS_BROWSING_URL_FIELDS.has(keyName(key)))) {
    throw new Error("Ambiguous page URL cannot leave the local agent.");
  }
  for (const key of keys) assertNoRawBrowsingHistory(value[key], depth + 1);
}

// Validate a detached snapshot, not an object that another local caller can
// mutate between validation and JSON serialization / MCP export.
export function snapshotLocalEvidence(value) {
  const detached = structuredClone(value);
  assertNoRawBrowsingHistory(detached);
  return detached;
}

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
    payload[field] = snapshotLocalEvidence(stored[storageKey] ?? null);
  }

  return payload;
}
