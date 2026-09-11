import { buildRecommendation, exposureAssessment, observedStateAgeDays } from "./core.js";
import { decisionConfidence } from "./decision-intelligence.js";

export function cleanupImpact(extensions = [], evidenceById = {}) {
  const result = {
    enabledExtensions: 0,
    enabledHighExposure: 0,
    enabledBroadHostAccess: 0,
    enabledSensitivePermissionGrants: 0,
    reviewCandidates: 0,
    highConfidenceCleanupCandidates: 0,
    candidateHighExposure: 0,
    candidateBroadHostAccess: 0,
    candidateSensitivePermissionGrants: 0
  };

  for (const extension of extensions) {
    if (!extension.enabled) continue;
    const evidence = evidenceById[extension.id] ?? {};
    const normalizedEvidence = {
      ...evidence,
      stateAgeDays: evidence.stateAgeDays ?? observedStateAgeDays(extension)
    };
    const exposure = exposureAssessment(extension);
    const recommendation = buildRecommendation(extension, normalizedEvidence);
    const confidence = decisionConfidence(extension, normalizedEvidence);

    result.enabledExtensions += 1;
    if (exposure.level === "high") result.enabledHighExposure += 1;
    if (exposure.broadHostAccess) result.enabledBroadHostAccess += 1;
    result.enabledSensitivePermissionGrants += exposure.sensitivePermissions.length;

    if (recommendation.kind !== "review") continue;
    result.reviewCandidates += 1;
    if (confidence.level === "high") result.highConfidenceCleanupCandidates += 1;
    if (exposure.level === "high") result.candidateHighExposure += 1;
    if (exposure.broadHostAccess) result.candidateBroadHostAccess += 1;
    result.candidateSensitivePermissionGrants += exposure.sensitivePermissions.length;
  }

  return result;
}

export function cleanupImpactNarrative(impact) {
  if (!impact?.reviewCandidates) {
    return "No enabled extensions currently have enough evidence to enter the cleanup review queue.";
  }

  const parts = [`${impact.reviewCandidates} enabled extension${impact.reviewCandidates === 1 ? " is" : "s are"} in the review queue`];
  if (impact.candidateHighExposure) parts.push(`${impact.candidateHighExposure} with high exposure`);
  if (impact.candidateBroadHostAccess) parts.push(`${impact.candidateBroadHostAccess} with broad website access`);
  if (impact.candidateSensitivePermissionGrants) {
    parts.push(`${impact.candidateSensitivePermissionGrants} mapped sensitive permission grant${impact.candidateSensitivePermissionGrants === 1 ? "" : "s"} across those candidates`);
  }
  return `${parts.join(" · ")}. These are potential reductions only; Xtension never removes them automatically.`;
}
