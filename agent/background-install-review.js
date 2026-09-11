import { installReview } from "./install-review-policy.js";

const ALERTS_KEY = "xtension.alerts.v1";
const MAX_ALERTS = 100;

async function readAlerts() {
  const stored = await chrome.storage.local.get(ALERTS_KEY);
  return Array.isArray(stored[ALERTS_KEY]) ? stored[ALERTS_KEY] : [];
}

async function refreshBadge(alerts) {
  const unread = alerts.filter((alert) => !alert.seen).length;
  await chrome.action.setBadgeText({ text: unread ? String(Math.min(unread, 99)) : "" });
  await chrome.action.setTitle({
    title: unread ? `Xtension · ${unread} extension review${unread === 1 ? "" : "s"} pending` : "Open Xtension"
  });
}

async function queueInstallReview(extension) {
  if (extension.type !== "extension") return;
  const policy = installReview(extension);
  if (!policy) return;

  const alert = {
    alertId: crypto.randomUUID(),
    at: Date.now(),
    extensionId: extension.id,
    extensionName: extension.name,
    ...policy,
    seen: false
  };

  const existing = await readAlerts();
  const deduped = existing.filter((item) =>
    !(item.kind === "install-review" && item.extensionId === extension.id && !item.seen)
  );
  const next = [alert, ...deduped].slice(0, MAX_ALERTS);
  await chrome.storage.local.set({ [ALERTS_KEY]: next });
  await refreshBadge(next);
}

chrome.management.onInstalled.addListener((extension) => {
  void queueInstallReview(extension).catch((error) =>
    console.error("Xtension new-install review failed", error)
  );
});
