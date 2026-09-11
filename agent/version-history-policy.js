function sortedUnique(values = []) {
  return [...new Set(values)].sort();
}

function sameArray(a = [], b = []) {
  const left = sortedUnique(a);
  const right = sortedUnique(b);
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

export function versionObservation(extension, observedAt = Date.now()) {
  return {
    observedAt,
    version: extension.version ?? null,
    enabled: Boolean(extension.enabled),
    permissions: sortedUnique(extension.permissions ?? []),
    hostPermissions: sortedUnique(extension.hostPermissions ?? [])
  };
}

export function materiallyChanged(previous, current) {
  if (!previous) return true;
  if ((previous.version ?? null) !== (current.version ?? null)) return true;
  if (!sameArray(previous.permissions, current.permissions)) return true;
  if (!sameArray(previous.hostPermissions, current.hostPermissions)) return true;
  return false;
}

export function appendVersionHistory(historyById = {}, previousSnapshot, nextSnapshot, maxPerExtension = 25) {
  const nextHistory = structuredClone(historyById ?? {});
  const before = new Map((previousSnapshot?.extensions ?? []).map((item) => [item.id, item]));

  for (const extension of nextSnapshot?.extensions ?? []) {
    const previous = before.get(extension.id) ?? null;
    if (!materiallyChanged(previous, extension)) continue;

    const observation = versionObservation(extension, nextSnapshot.observedAt ?? Date.now());
    const existing = Array.isArray(nextHistory[extension.id]) ? nextHistory[extension.id] : [];
    const last = existing.at(-1);

    // Storage events can be replayed around service-worker lifecycle transitions.
    // Do not duplicate an equivalent terminal observation.
    if (last && !materiallyChanged(last, observation)) continue;

    nextHistory[extension.id] = [...existing, observation].slice(-maxPerExtension);
  }

  return nextHistory;
}
