import { buildRecommendation, exposureLevel, observedStateAgeDays } from "./core.js";
import { trialDurationDays, trialEvidenceStrength } from "./trial-policy.js";

export function decisionConfidence(extension, evidence = {}) {
  const trial = evidence.trial ?? null;
  const verdict = evidence.verdict ?? null;
  const workflow = evidence.workflow ?? null;
  const redundancy = evidence.redundancy ?? null;
  const stateAgeDays = evidence.stateAgeDays ?? observedStateAgeDays(extension);
  const reasons = [];

  if (verdict) {
    reasons.push("explicit user verdict");
    return { level: "high", reasons };
  }

  if (trial?.outcome === "needed") {
    reasons.push("restored during disable trial");
    return { level: "high", reasons };
  }

  if (trial?.outcome === "survived-trial") {
    const strength = trialEvidenceStrength(trial);
    const days = trialDurationDays(trial);
    reasons.push(
      days > 0
        ? `completed about ${Math.round(days)} days disabled without a recorded restore`
        : "completed a disable trial without a recorded restore"
    );
    if (strength === "high") return { level: "high", reasons };
    if (strength === "medium") {
      reasons.push("shorter trials can miss monthly or infrequent workflows");
      return { level: "medium", reasons };
    }
    reasons.push("trial duration is too short or unknown to support a strong cleanup conclusion");
    return { level: "low", reasons };
  }

  if (!extension.enabled && stateAgeDays >= 30) reasons.push("continuously observed disabled for 30+ days");
  if (workflow?.kind === "no-overlap") reasons.push("no recent overlap with declared sites");
  if (workflow?.kind === "overlap") reasons.push("recent overlap with declared sites");

  if (reasons.length) {
    return { level: "medium", reasons };
  }

  if (redundancy) reasons.push("low-confidence category overlap hint");
  if (exposureLevel(extension) === "high") reasons.push("high capability exposure alone does not establish usefulness");
  if (!reasons.length) reasons.push("insufficient behavioral or user evidence");
  return { level: "low", reasons };
}

export function portfolioSummary(extensions = [], evidenceById = {}) {
  const summary = {
    installed: extensions.length,
    enabled: 0,
    disabled: 0,
    highExposureEnabled: 0,
    needsReview: 0,
    highConfidenceReviews: 0,
    longDisabled: 0,
    markedUnnecessary: 0,
    markedEssential: 0,
    activeTrials: 0
  };

  for (const extension of extensions) {
    const evidence = evidenceById[extension.id] ?? {};
    const recommendation = buildRecommendation(extension, evidence);
    const confidence = decisionConfidence(extension, evidence);
    const exposure = exposureLevel(extension);
    const stateAgeDays = evidence.stateAgeDays ?? observedStateAgeDays(extension);

    if (extension.enabled) summary.enabled += 1;
    else summary.disabled += 1;
    if (extension.enabled && exposure === "high") summary.highExposureEnabled += 1;
    if (recommendation.kind === "review") summary.needsReview += 1;
    if (recommendation.kind === "review" && confidence.level === "high") summary.highConfidenceReviews += 1;
    if (!extension.enabled && stateAgeDays >= 30) summary.longDisabled += 1;
    if (evidence.verdict === "unnecessary") summary.markedUnnecessary += 1;
    if (evidence.verdict === "essential") summary.markedEssential += 1;
    if (evidence.trial?.active) summary.activeTrials += 1;
  }

  return summary;
}
