import { exposureAssessment } from "./core.js";

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

  const assessment = exposureAssessment({
    permissions: extension.permissions ?? [],
    hostPermissions: extension.hostPermissions ?? []
  });

  // A new extension is not suspicious merely because it has powerful access.
  // We only interrupt for the broadest capability surfaces so the user can
  // decide whether the workflow value justifies them.
  if (assessment.level !== "high") return;

  const reasons = assessment.reasons.length
    ? assessment.reasons.join(" · ")
    : "high capability exposure";
  const alert = {
    alertId: crypto.randomUUID(),
    at: Date.now(),
    extensionId: extension.id,
    extensionName: extension.name,
    severity: "high",
    kind: "install-review",
    summary: `${extension.name} was installed with high exposure`,
    detail: `${reasons}. This is a capability review, not a malware verdict.`,
    data: {
      permissions: [...new Set(extension.permissions ?? [])].sort(),
      hostPermissions: [...new Set(extension.hostPermissions ?? [])].sort()
    },
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
