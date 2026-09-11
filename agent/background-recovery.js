const INVENTORY_KEY = "xtension.inventory.v1";
const REMOVED_KEY = "xtension.removed.v1";
const MAX_REMOVED = 100;

function storeUrl(id) {
  return `https://chromewebstore.google.com/detail/${encodeURIComponent(id)}`;
}

async function readArchive() {
  const stored = await chrome.storage.local.get(REMOVED_KEY);
  return Array.isArray(stored[REMOVED_KEY]) ? stored[REMOVED_KEY] : [];
}

async function archiveFromLastInventory(extensionId) {
  const stored = await chrome.storage.local.get([INVENTORY_KEY, REMOVED_KEY]);
  const prior = stored[INVENTORY_KEY]?.extensions?.find((item) => item.id === extensionId);
  if (!prior) return;

  const archive = Array.isArray(stored[REMOVED_KEY]) ? stored[REMOVED_KEY] : [];
  const record = {
    id: prior.id,
    name: prior.name,
    shortName: prior.shortName ?? null,
    description: prior.description ?? "",
    version: prior.version ?? null,
    homepageUrl: prior.homepageUrl ?? null,
    installType: prior.installType ?? null,
    permissions: [...new Set(prior.permissions ?? [])].sort(),
    hostPermissions: [...new Set(prior.hostPermissions ?? [])].sort(),
    icons: prior.icons ?? [],
    removedAt: Date.now(),
    storeUrl: storeUrl(prior.id)
  };

  const next = [record, ...archive.filter((item) => item.id !== extensionId)].slice(0, MAX_REMOVED);
  await chrome.storage.local.set({ [REMOVED_KEY]: next });
}

async function clearRecoveredRecord(extensionId) {
  const archive = await readArchive();
  const next = archive.filter((item) => item.id !== extensionId);
  if (next.length !== archive.length) await chrome.storage.local.set({ [REMOVED_KEY]: next });
}

// This module is imported before the main service worker registers its own
// management listeners. Capturing the stored inventory here preserves the
// last-known metadata before normal reconciliation replaces the snapshot.
chrome.management.onUninstalled.addListener((extensionId) => {
  void archiveFromLastInventory(extensionId).catch((error) =>
    console.error("Xtension background recovery archive failed", error)
  );
});

chrome.management.onInstalled.addListener((extension) => {
  if (extension.type !== "extension") return;
  void clearRecoveredRecord(extension.id).catch((error) =>
    console.error("Xtension background recovery cleanup failed", error)
  );
});
