const INVENTORY_KEY = "xtension.inventory.v1";
const TRIALS_KEY = "xtension.trials.v1";

async function collectInventory() {
  const self = await chrome.management.getSelf();
  const items = await chrome.management.getAll();

  const extensions = items
    .filter((item) => item.type === "extension" && item.id !== self.id)
    .map((item) => ({
      id: item.id,
      name: item.name,
      shortName: item.shortName,
      description: item.description,
      version: item.version,
      versionName: item.versionName ?? null,
      enabled: item.enabled,
      disabledReason: item.disabledReason ?? null,
      installType: item.installType,
      mayDisable: item.mayDisable,
      mayEnable: item.mayEnable ?? null,
      permissions: item.permissions ?? [],
      hostPermissions: item.hostPermissions ?? [],
      optionsUrl: item.optionsUrl || null,
      homepageUrl: item.homepageUrl ?? null,
      icons: item.icons ?? []
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const snapshot = {
    observedAt: Date.now(),
    extensions
  };

  await chrome.storage.local.set({ [INVENTORY_KEY]: snapshot });
  return snapshot;
}

async function refreshAfterManagementChange() {
  try {
    await collectInventory();
  } catch (error) {
    console.error("Xtension inventory refresh failed", error);
  }
}

chrome.runtime.onInstalled.addListener(() => {
  void collectInventory();
});

chrome.runtime.onStartup.addListener(() => {
  void collectInventory();
});

chrome.management.onInstalled.addListener(refreshAfterManagementChange);
chrome.management.onUninstalled.addListener(refreshAfterManagementChange);
chrome.management.onEnabled.addListener(refreshAfterManagementChange);
chrome.management.onDisabled.addListener(refreshAfterManagementChange);

chrome.action.onClicked.addListener(async () => {
  await chrome.tabs.create({ url: chrome.runtime.getURL("dashboard.html") });
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || typeof message !== "object") return false;

  if (message.type === "inventory:get") {
    (async () => {
      const stored = await chrome.storage.local.get(INVENTORY_KEY);
      const existing = stored[INVENTORY_KEY];
      sendResponse(existing ?? (await collectInventory()));
    })().catch((error) => sendResponse({ error: error.message }));
    return true;
  }

  if (message.type === "inventory:refresh") {
    collectInventory()
      .then(sendResponse)
      .catch((error) => sendResponse({ error: error.message }));
    return true;
  }

  if (message.type === "trials:get") {
    chrome.storage.local
      .get(TRIALS_KEY)
      .then((stored) => sendResponse(stored[TRIALS_KEY] ?? {}))
      .catch((error) => sendResponse({ error: error.message }));
    return true;
  }

  return false;
});
