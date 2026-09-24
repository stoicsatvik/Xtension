const ALLOWED_WORKFLOW_KINDS = new Set(["no-hosts", "broad", "overlap", "no-overlap"]);

function finiteCount(value) {
  return Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
}

function sanitizeWorkflowSignal(signal) {
  if (!signal || !ALLOWED_WORKFLOW_KINDS.has(signal.kind)) return null;
  return {
    kind: signal.kind,
    totalRecentPages: finiteCount(signal.totalRecentPages),
    matchedPages: finiteCount(signal.matchedPages),
    matchedHosts: finiteCount(signal.matchedHosts)
  };
}

function sanitizeStaticAnalysis(analysis) {
  if (!analysis || typeof analysis !== "object") return null;
  return {
    declaredPermissions: Array.isArray(analysis.declaredPermissions)
      ? analysis.declaredPermissions.filter((value) => typeof value === "string")
      : [],
    staticReferences: Array.isArray(analysis.staticReferences)
      ? analysis.staticReferences.filter((value) => typeof value === "string")
      : [],
    broadHostAccess: analysis.broadHostAccess === true
  };
}

export function buildAnalyzerEnrichment({ inventory = [], workflowSignals = {}, analyzerById = {} } = {}) {
  return inventory.map((extension) => {
    const id = typeof extension?.id === "string" ? extension.id : null;
    if (!id) throw new Error("inventory extension id is required");

    return {
      id,
      name: typeof extension.name === "string" ? extension.name : null,
      enabled: extension.enabled === true,
      evidence: {
        declaredCapability: sanitizeStaticAnalysis(analyzerById[id]),
        localWorkflowRelevance: sanitizeWorkflowSignal(workflowSignals[id]),
        observedMaliciousBehavior: null
      }
    };
  });
}

export function assertPrivacyPreservingEnrichment(payload) {
  const serialized = JSON.stringify(payload).toLowerCase();
  const forbidden = ["rawhistory", "raw-history", "browsinghistory", "browsing-history", "historyurls", "visitedurls"];
  if (forbidden.some((token) => serialized.includes(token))) {
    throw new Error("raw browsing-history material is forbidden in analyzer enrichment");
  }
  return payload;
}

export function buildSafeAnalyzerEnrichment(input) {
  return assertPrivacyPreservingEnrichment(buildAnalyzerEnrichment(input));
}
