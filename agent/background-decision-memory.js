import { decisionBasis } from "./decision-memory.js";

const PREFERENCES_KEY = "xtension.preferences.v1";
const INVENTORY_KEY = "xtension.inventory.v1";
const TRIALS_KEY = "xtension.trials.v1";

async function enrichDecisionMemory(change) {
  const nextPreferences = change?.newValue;
  if (!nextPreferences || typeof nextPreferences !== "object") return;

  const previousPreferences = change.oldValue ?? {};
  const stored = await chrome.storage.local.get([INVENTORY_KEY, TRIALS_KEY]);
  const extensions = stored[INVENTORY_KEY]?.extensions ?? [];
  const trials = stored[TRIALS_KEY] ?? {};
  const byId = new Map(extensions.map((extension) => [extension.id, extension]));
  let changed = false;
  const enriched = { ...nextPreferences };

  for (const [extensionId, preference] of Object.entries(nextPreferences)) {
    if (!preference?.verdict) continue;
    const extension = byId.get(extensionId);
    if (!extension) continue;

    const previous = previousPreferences[extensionId] ?? {};
    const verdictChanged = previous.verdict !== preference.verdict;
    const decisionWasTouched = previous.updatedAt !== preference.updatedAt;
    if (preference.decisionBasis && !verdictChanged && !decisionWasTouched) continue;

    enriched[extensionId] = {
      ...preference,
      decisionBasis: decisionBasis(extension, { trial: trials[extensionId] ?? null }),
      decisionBasisAt: Date.now()
    };
    changed = true;
  }

  if (changed) await chrome.storage.local.set({ [PREFERENCES_KEY]: enriched });
}

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local" || !changes[PREFERENCES_KEY]) return;
  void enrichDecisionMemory(changes[PREFERENCES_KEY]).catch((error) =>
    console.error("Xtension decision-memory enrichment failed", error)
  );
});
