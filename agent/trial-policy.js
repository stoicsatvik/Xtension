const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_DEPENDENCY_REASON_CHARS = 300;

export function trialDurationDays(trial) {
  if (!trial?.startedAt || !trial?.plannedEndAt) return 0;
  return Math.max(0, (trial.plannedEndAt - trial.startedAt) / DAY_MS);
}

export function trialEvidenceStrength(trial) {
  if (!trial?.outcome) return "none";
  if (trial.outcome === "needed") return "high";
  if (trial.outcome !== "survived-trial") return "none";

  const days = trialDurationDays(trial);
  if (days >= 21) return "high";
  if (days >= 7) return "medium";
  if (days > 0) return "low";
  return "unknown";
}

export function normalizeDependencyReason(value) {
  if (typeof value !== "string") return null;
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) return null;
  return normalized.slice(0, MAX_DEPENDENCY_REASON_CHARS);
}

export function applyTrialAnnotation(trial, reason, at = Date.now()) {
  if (!trial || trial.outcome !== "needed") {
    throw new Error("Dependency reasons can only annotate trials that ended because the extension was needed.");
  }
  const normalized = normalizeDependencyReason(reason);
  if (!normalized) {
    return {
      ...trial,
      dependencyReason: null,
      dependencyReasonAt: null
    };
  }
  return {
    ...trial,
    dependencyReason: normalized,
    dependencyReasonAt: at
  };
}

export function reconcileTrialObservation(trial, observation, now = Date.now()) {
  if (!trial?.active) return null;

  if (!observation?.exists) {
    return {
      outcome: "uninstalled",
      status: "ended",
      endedAt: now,
      reason: "The extension disappeared while its disable trial was active."
    };
  }

  if (observation.enabled) {
    return {
      outcome: "needed",
      status: "ended",
      endedAt: now,
      reason: "The extension was enabled again before the trial completed."
    };
  }

  if (trial.plannedEndAt && trial.plannedEndAt <= now) {
    return {
      outcome: "survived-trial",
      status: "completed",
      endedAt: now,
      reason: "The planned disable period completed while the extension remained disabled."
    };
  }

  return null;
}

export function applyTrialOutcome(trial, transition) {
  if (!trial || !transition) return trial ?? null;
  return {
    ...trial,
    active: false,
    status: transition.status,
    endedAt: transition.endedAt,
    outcome: transition.outcome,
    outcomeReason: transition.reason
  };
}
