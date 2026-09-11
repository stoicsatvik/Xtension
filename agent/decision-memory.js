function sorted(values = []) {
  return [...new Set(Array.isArray(values) ? values : [])].sort();
}

export function decisionBasis(extension, evidence = {}) {
  return JSON.stringify({
    permissions: sorted(extension?.permissions),
    hostPermissions: sorted(extension?.hostPermissions),
    installType: extension?.installType ?? null,
    mayDisable: extension?.mayDisable ?? null,
    trialOutcome: evidence?.trial?.outcome ?? null
  });
}

export function decisionMemoryState(extension, preference = {}, evidence = {}, now = Date.now()) {
  if (!preference?.verdict) {
    return { state: "unreviewed", fresh: false, reason: "No explicit user verdict exists." };
  }

  if (Number.isFinite(preference.reviewAt) && preference.reviewAt <= now) {
    return { state: "due", fresh: false, reason: "The user-scheduled review date has arrived." };
  }

  if (!preference.decisionBasis) {
    return { state: "legacy", fresh: false, reason: "This verdict predates decision-memory evidence and should be reviewed once." };
  }

  const currentBasis = decisionBasis(extension, evidence);
  if (currentBasis !== preference.decisionBasis) {
    return {
      state: "stale",
      fresh: false,
      reason: "The extension's material access or trial evidence changed since the last verdict."
    };
  }

  return {
    state: "fresh",
    fresh: true,
    reason: "The explicit verdict still matches the extension's material access and trial evidence."
  };
}

export function shouldIncludeInAudit(extension, preference = {}, evidence = {}, now = Date.now()) {
  return !decisionMemoryState(extension, preference, evidence, now).fresh;
}
