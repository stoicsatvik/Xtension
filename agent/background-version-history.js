import { appendVersionHistory } from "./version-history-policy.js";

const INVENTORY_KEY = "xtension.inventory.v1";
const VERSION_HISTORY_KEY = "xtension.version-history.v1";

async function persistInventoryHistory(previousSnapshot, nextSnapshot) {
  if (!nextSnapshot?.extensions) return;
  const stored = await chrome.storage.local.get(VERSION_HISTORY_KEY);
  const existing = stored[VERSION_HISTORY_KEY] ?? {};
  const next = appendVersionHistory(existing, previousSnapshot, nextSnapshot);

  if (JSON.stringify(next) === JSON.stringify(existing)) return;
  await chrome.storage.local.set({ [VERSION_HISTORY_KEY]: next });
}

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local" || !changes[INVENTORY_KEY]) return;
  const { oldValue, newValue } = changes[INVENTORY_KEY];
  void persistInventoryHistory(oldValue ?? null, newValue ?? null).catch((error) =>
    console.error("Xtension version-history persistence failed", error)
  );
});
