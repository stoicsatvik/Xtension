import { exposureAssessment } from "./core.js";

function trialDays(trial) {
  if (!trial?.startedAt || !trial?.endedAt) return 0;
  return Math.max(0, (trial.endedAt - trial.startedAt) / (24 * 60 * 60 * 1000));
}

export function realizedImpact({ extensions = [], removedExtensions = [], trials = {} } = {}) {
  const result = {
    observedRemovals: removedExtensions.length,
    removedHighExposure: 0,
    removedBroadHostAccess: 0,
    removedSensitivePermissionGrants: 0,
    restoredDuringTrial: 0,
    survivedTrials: 0,
    longSurvivedTrials: 0,
    currentlyDisabled: 0,
    currentlyDisabledHighExposure: 0
  };

  for (const extension of removedExtensions) {
    const exposure = exposureAssessment(extension);
    if (exposure.level === "high") result.removedHighExposure += 1;
    if (exposure.broadHostAccess) result.removedBroadHostAccess += 1;
    result.removedSensitivePermissionGrants += exposure.sensitivePermissions.length;
  }

  for (const trial of Object.values(trials)) {
    if (trial?.outcome === "needed") result.restoredDuringTrial += 1;
    if (trial?.outcome === "survived-trial") {
      result.survivedTrials += 1;
      if (trialDays(trial) >= 21) result.longSurvivedTrials += 1;
    }
  }

  for (const extension of extensions) {
    if (extension.enabled) continue;
    result.currentlyDisabled += 1;
    if (exposureAssessment(extension).level === "high") result.currentlyDisabledHighExposure += 1;
  }

  return result;
}

export function realizedImpactNarrative(impact) {
  if (!impact) return "No local outcome evidence yet.";

  const parts = [];
  if (impact.observedRemovals) {
    parts.push(`${impact.observedRemovals} extension${impact.observedRemovals === 1 ? "" : "s"} observed removed`);
  }
  if (impact.removedBroadHostAccess) {
    parts.push(`${impact.removedBroadHostAccess} removed item${impact.removedBroadHostAccess === 1 ? " had" : "s had"} broad website access`);
  }
  if (impact.restoredDuringTrial) {
    parts.push(`${impact.restoredDuringTrial} disable trial${impact.restoredDuringTrial === 1 ? " exposed" : "s exposed"} real dependency`);
  }
  if (impact.survivedTrials) {
    parts.push(`${impact.survivedTrials} trial${impact.survivedTrials === 1 ? " completed" : "s completed"} without restore`);
  }

  if (!parts.length) {
    return "No cleanup outcomes have been observed yet. Xtension will report changes only after actual local evidence exists.";
  }

  return `${parts.join(" · ")}. Removal counts are observed outcomes, not claims that Xtension caused the removal.`;
}
