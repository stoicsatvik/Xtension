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
