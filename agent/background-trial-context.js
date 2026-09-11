import { applyTrialAnnotation } from "./trial-policy.js";

const TRIALS_KEY = "xtension.trials.v1";
const TIMELINE_KEY = "xtension.timeline.v1";
const MAX_TIMELINE_EVENTS = 500;

async function annotateTrial(extensionId, reason) {
  if (typeof extensionId !== "string" || !extensionId) throw new Error("Missing extension ID.");
  const stored = await chrome.storage.local.get([TRIALS_KEY, TIMELINE_KEY]);
  const trials = stored[TRIALS_KEY] ?? {};
  const trial = trials[extensionId];
  if (!trial) throw new Error("No trial record exists for this extension.");

  const nextTrial = applyTrialAnnotation(trial, reason);
  trials[extensionId] = nextTrial;

  const timeline = Array.isArray(stored[TIMELINE_KEY]) ? stored[TIMELINE_KEY] : [];
  const event = {
    eventId: crypto.randomUUID(),
    at: Date.now(),
    extensionId,
    extensionName: trial.extensionName ?? "Unknown extension",
    kind: "trial-context",
    summary: nextTrial.dependencyReason
      ? `Recorded why ${trial.extensionName ?? "this extension"} was needed`
      : `Cleared restore context for ${trial.extensionName ?? "this extension"}`,
    detail: nextTrial.dependencyReason ?? null,
    data: null
  };

  await chrome.storage.local.set({
    [TRIALS_KEY]: trials,
    [TIMELINE_KEY]: [event, ...timeline].slice(0, MAX_TIMELINE_EVENTS)
  });
  return nextTrial;
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || message.type !== "trial:annotate") return false;
  annotateTrial(message.extensionId, message.reason)
    .then(sendResponse)
    .catch((error) => sendResponse({ error: error?.message || String(error) }));
  return true;
});
