import { decisionMemoryState } from "./decision-memory.js";
import { normalizeAuditSession } from "./audit-session.js";

const PREFERENCES_KEY = "xtension.preferences.v1";
const AUDIT_SESSION_KEY = "xtension.audit.session.v1";
const AUTO_SKIPPED_KEY = "xtension.audit.decision-memory-skips.v1";

async function worker(message) {
  const response = await chrome.runtime.sendMessage(message);
  if (response?.error) throw new Error(response.error);
  return response;
}

async function applyDecisionMemoryToAudit() {
  const [snapshot, trials, stored] = await Promise.all([
    worker({ type: "inventory:get" }),
    worker({ type: "trials:get" }),
    chrome.storage.local.get([PREFERENCES_KEY, AUDIT_SESSION_KEY, AUTO_SKIPPED_KEY])
  ]);

  const preferences = stored[PREFERENCES_KEY] ?? {};
  const validIds = snapshot.extensions.map((extension) => extension.id);
  const session = normalizeAuditSession(stored[AUDIT_SESSION_KEY], validIds);
  const previousAutoSkipped = new Set(
    Array.isArray(stored[AUTO_SKIPPED_KEY]) ? stored[AUTO_SKIPPED_KEY] : []
  );

  const manuallySkipped = new Set(
    session.skippedIds.filter((id) => !previousAutoSkipped.has(id))
  );
  const freshDecisionIds = [];

  for (const extension of snapshot.extensions) {
    const preference = preferences[extension.id] ?? {};
    const memory = decisionMemoryState(
      extension,
      preference,
      { trial: trials[extension.id] ?? null }
    );
    if (memory.fresh) freshDecisionIds.push(extension.id);
  }

  const skippedIds = [...new Set([...manuallySkipped, ...freshDecisionIds])];
  await chrome.storage.local.set({
    [AUDIT_SESSION_KEY]: { ...session, skippedIds },
    [AUTO_SKIPPED_KEY]: freshDecisionIds
  });
}

await applyDecisionMemoryToAudit();
