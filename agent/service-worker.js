const INVENTORY_KEY = "xtension.inventory.v1";
const TRIALS_KEY = "xtension.trials.v1";
const TIMELINE_KEY = "xtension.timeline.v1";
const MAX_TIMELINE_EVENTS = 500;
const TRIAL_ALARM_PREFIX = "xtension.trial.";
const INVENTORY_REFRESH_ALARM = "xtension.inventory.refresh";
const INVENTORY_REFRESH_MINUTES = 6 * 60;

function sortedUnique(values = []) {
  return [...new Set(values)].sort();
}

function sameArray(a = [], b = []) {
  const left = sortedUnique(a);
  const right = sortedUnique(b);
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function normalizeItem(item) {
  return {
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
    permissions: sortedUnique(item.permissions ?? []),
    hostPermissions: sortedUnique(item.hostPermissions ?? []),
    optionsUrl: item.optionsUrl || null,
    homepageUrl: item.homepageUrl ?? null,
    icons: item.icons ?? []
  };
}

async function appendTimeline(events) {
  if (!events?.length) return;
  const stored = await chrome.storage.local.get(TIMELINE_KEY);
  const existing = Array.isArray(stored[TIMELINE_KEY]) ? stored[TIMELINE_KEY] : [];
  const next = [...events, ...existing].slice(0, MAX_TIMELINE_EVENTS);
  await chrome.storage.local.set({ [TIMELINE_KEY]: next });
}

function eventFor(extension, kind, summary, detail = null, at = Date.now()) {
  return {
    eventId: crypto.randomUUID(),
    at,
    extensionId: extension?.id ?? null,
    extensionName: extension?.name ?? "Unknown extension",
    kind,
    summary,
    detail
  };
}

function diffSnapshots(previous, next) {
  if (!previous?.extensions?.length) return [];

  const at = next.observedAt;
  const before = new Map(previous.extensions.map((item) => [item.id, item]));
  const after = new Map(next.extensions.map((item) => [item.id, item]));
  const events = [];

  for (const [id, current] of after) {
    const prior = before.get(id);
    if (!prior) {
      events.push(eventFor(current, "installed", `${current.name} was installed`, `Version ${current.version}`, at));
      continue;
    }

    if (prior.enabled !== current.enabled) {
      events.push(
        eventFor(
          current,
          current.enabled ? "enabled" : "disabled",
          `${current.name} was ${current.enabled ? "enabled" : "disabled"}`,
          current.disabledReason ? `Reason: ${current.disabledReason}` : null,
          at
        )
      );
    }

    if (prior.version !== current.version) {
      events.push(
        eventFor(
          current,
          "version-change",
          `${current.name} updated`,
          `${prior.version} → ${current.version}`,
          at
        )
      );
    }

    if (!sameArray(prior.permissions, current.permissions) || !sameArray(prior.hostPermissions, current.hostPermissions)) {
      const addedPermissions = current.permissions.filter((value) => !prior.permissions.includes(value));
      const removedPermissions = prior.permissions.filter((value) => !current.permissions.includes(value));
      const addedHosts = current.hostPermissions.filter((value) => !prior.hostPermissions.includes(value));
      const removedHosts = prior.hostPermissions.filter((value) => !current.hostPermissions.includes(value));
      const parts = [];
      if (addedPermissions.length) parts.push(`+ permissions: ${addedPermissions.join(", ")}`);
      if (removedPermissions.length) parts.push(`- permissions: ${removedPermissions.join(", ")}`);
      if (addedHosts.length) parts.push(`+ hosts: ${addedHosts.join(", ")}`);
      if (removedHosts.length) parts.push(`- hosts: ${removedHosts.join(", ")}`);
      events.push(
        eventFor(
          current,
          "permission-change",
          `${current.name} changed its access surface`,
          parts.join(" · "),
          at
        )
      );
    }
  }

  for (const [id, prior] of before) {
    if (!after.has(id)) {
      events.push(eventFor(prior, "uninstalled", `${prior.name} was uninstalled`, `Last seen version ${prior.version}`, at));
    }
  }

  return events;
}

async function collectInventory() {
  const stored = await chrome.storage.local.get(INVENTORY_KEY);
  const previous = stored[INVENTORY_KEY] ?? null;
  const self = await chrome.management.getSelf();
  const items = await chrome.management.getAll();

  const extensions = items
    .filter((item) => item.type === "extension" && item.id !== self.id)
    .map(normalizeItem)
    .sort((a, b) => a.name.localeCompare(b.name));

  const snapshot = {
    observedAt: Date.now(),
    extensions
  };

  const changes = diffSnapshots(previous, snapshot);
  await chrome.storage.local.set({ [INVENTORY_KEY]: snapshot });
  await appendTimeline(changes);
  return snapshot;
}

async function getTrials() {
  const stored = await chrome.storage.local.get(TRIALS_KEY);
  return stored[TRIALS_KEY] ?? {};
}

async function saveTrials(trials) {
  await chrome.storage.local.set({ [TRIALS_KEY]: trials });
}

async function completeTrial(extensionId) {
  const trials = await getTrials();
  const trial = trials[extensionId];
  if (!trial?.active) return null;

  const extension = await chrome.management.get(extensionId).catch(() => null);
  trials[extensionId] = {
    ...trial,
    active: false,
    status: "completed",
    endedAt: Date.now(),
    outcome: "survived-trial"
  };
  await saveTrials(trials);

  if (extension) {
    await appendTimeline([
      eventFor(extension, "trial-completed", `${extension.name} completed its disable trial`, "No automatic re-enable or uninstall was performed.")
    ]);
  }

  return trials[extensionId];
}

async function ensureBackgroundState() {
  const inventoryAlarm = await chrome.alarms.get(INVENTORY_REFRESH_ALARM);
  if (!inventoryAlarm) {
    await chrome.alarms.create(INVENTORY_REFRESH_ALARM, {
      delayInMinutes: INVENTORY_REFRESH_MINUTES,
      periodInMinutes: INVENTORY_REFRESH_MINUTES
    });
  }

  const trials = await getTrials();
  const now = Date.now();

  for (const [extensionId, trial] of Object.entries(trials)) {
    if (!trial?.active || !trial.plannedEndAt) continue;

    if (trial.plannedEndAt <= now) {
      await completeTrial(extensionId);
      continue;
    }

    const alarmName = `${TRIAL_ALARM_PREFIX}${extensionId}`;
    const existing = await chrome.alarms.get(alarmName);
    if (!existing) {
      await chrome.alarms.create(alarmName, { when: trial.plannedEndAt });
    }
  }
}

async function startTrial(extensionId, days = 7) {
  const extension = await chrome.management.get(extensionId);
  const self = await chrome.management.getSelf();
  if (extension.id === self.id) throw new Error("Xtension cannot trial-disable itself.");
  if (!extension.mayDisable) throw new Error("Chrome does not allow this extension to be disabled by the user.");
  if (!Number.isFinite(days) || days <= 0 || days > 30) throw new Error("Trial duration must be between 1 and 30 days.");

  const trials = await getTrials();
  const startedAt = Date.now();
  const plannedEndAt = startedAt + days * 24 * 60 * 60 * 1000;

  if (extension.enabled) await chrome.management.setEnabled(extensionId, false);

  trials[extensionId] = {
    active: true,
    status: "active",
    startedAt,
    plannedEndAt,
    originalVersion: extension.version,
    outcome: null
  };
  await saveTrials(trials);
  await chrome.alarms.create(`${TRIAL_ALARM_PREFIX}${extensionId}`, { when: plannedEndAt });
  await appendTimeline([
    eventFor(extension, "trial-started", `${extension.name} entered a ${days}-day disable trial`, "Xtension will not uninstall it automatically.")
  ]);

  return trials[extensionId];
}

async function markTrial(extensionId, patch) {
  const trials = await getTrials();
  if (!trials[extensionId]) return null;
  trials[extensionId] = { ...trials[extensionId], ...patch };
  await saveTrials(trials);
  return trials[extensionId];
}

async function endTrial(extensionId, outcome = "ended-manually") {
  const extension = await chrome.management.get(extensionId).catch(() => null);
  const trial = await markTrial(extensionId, {
    active: false,
    status: "ended",
    endedAt: Date.now(),
    outcome
  });
  await chrome.alarms.clear(`${TRIAL_ALARM_PREFIX}${extensionId}`);
  if (trial && extension) {
    await appendTimeline([
      eventFor(extension, "trial-ended", `${extension.name} trial ended`, `Outcome: ${outcome}`)
    ]);
  }
  return trial;
}

async function enableExtension(extensionId) {
  const extension = await chrome.management.get(extensionId);
  await chrome.management.setEnabled(extensionId, true);
  const trials = await getTrials();
  if (trials[extensionId]?.active) {
    await markTrial(extensionId, {
      active: false,
      status: "ended",
      endedAt: Date.now(),
      outcome: "needed"
    });
    await chrome.alarms.clear(`${TRIAL_ALARM_PREFIX}${extensionId}`);
    await appendTimeline([
      eventFor(extension, "trial-needed", `${extension.name} was restored during its trial`, "Strong evidence that the extension matters to the workflow.")
    ]);
  }
  return true;
}

async function uninstallExtension(extensionId) {
  const extension = await chrome.management.get(extensionId);
  await chrome.management.uninstall(extensionId, { showConfirmDialog: true });
  const trials = await getTrials();
  if (trials[extensionId]) {
    await markTrial(extensionId, {
      active: false,
      status: "ended",
      endedAt: Date.now(),
      outcome: "uninstalled"
    });
    await chrome.alarms.clear(`${TRIAL_ALARM_PREFIX}${extensionId}`);
  }
  await appendTimeline([
    eventFor(extension, "cleanup", `${extension.name} was removed through Xtension`, null)
  ]);
  return true;
}

async function refreshAfterManagementChange() {
  try {
    await collectInventory();
  } catch (error) {
    console.error("Xtension inventory refresh failed", error);
  }
}

chrome.runtime.onInstalled.addListener(() => {
  void Promise.all([collectInventory(), ensureBackgroundState()]);
});

chrome.runtime.onStartup.addListener(() => {
  void Promise.all([collectInventory(), ensureBackgroundState()]);
});

chrome.management.onInstalled.addListener(refreshAfterManagementChange);
chrome.management.onUninstalled.addListener(refreshAfterManagementChange);
chrome.management.onEnabled.addListener(refreshAfterManagementChange);
chrome.management.onDisabled.addListener(refreshAfterManagementChange);

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === INVENTORY_REFRESH_ALARM) {
    void collectInventory().catch((error) => console.error("Xtension periodic inventory refresh failed", error));
    return;
  }

  if (!alarm.name.startsWith(TRIAL_ALARM_PREFIX)) return;
  const extensionId = alarm.name.slice(TRIAL_ALARM_PREFIX.length);
  void completeTrial(extensionId).catch((error) => console.error("Xtension trial completion failed", error));
});

chrome.action.onClicked.addListener(async () => {
  await chrome.tabs.create({ url: chrome.runtime.getURL("dashboard.html") });
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || typeof message !== "object") return false;

  const respond = (promise) => {
    promise.then(sendResponse).catch((error) => sendResponse({ error: error?.message || String(error) }));
    return true;
  };

  if (message.type === "inventory:get") {
    return respond((async () => {
      const stored = await chrome.storage.local.get(INVENTORY_KEY);
      return stored[INVENTORY_KEY] ?? (await collectInventory());
    })());
  }

  if (message.type === "inventory:refresh") return respond(collectInventory());
  if (message.type === "trials:get") return respond(getTrials());

  if (message.type === "timeline:get") {
    return respond((async () => {
      const stored = await chrome.storage.local.get(TIMELINE_KEY);
      return Array.isArray(stored[TIMELINE_KEY]) ? stored[TIMELINE_KEY] : [];
    })());
  }

  if (message.type === "trial:start") return respond(startTrial(message.extensionId, message.days ?? 7));
  if (message.type === "trial:end") return respond(endTrial(message.extensionId, message.outcome ?? "ended-manually"));
  if (message.type === "extension:enable") return respond(enableExtension(message.extensionId));
  if (message.type === "extension:uninstall") return respond(uninstallExtension(message.extensionId));

  return false;
});

// MV3 service workers can be recreated at any time. Reconcile important alarms whenever this worker starts.
void ensureBackgroundState().catch((error) => console.error("Xtension background reconciliation failed", error));
