import {
  HISTORY_WINDOW_DAYS,
  attentionPriority,
  buildRecommendation,
  deriveWorkflowSignals,
  exposureAssessment,
  findPotentialRedundancies,
  observedStateAgeDays
} from "./core.js";
import { decisionConfidence, portfolioSummary } from "./decision-intelligence.js";
import { describePermissions, summarizeHostAccess } from "./permission-catalog.js";

const PREFERENCES_KEY = "xtension.preferences.v1";
const state = {
  snapshot: { observedAt: 0, extensions: [] },
  trials: {},
  timeline: [],
  alerts: [],
  preferences: {},
  workflowSignals: {},
  redundancySignals: {},
  query: "",
  filter: "all"
};

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function preferenceFor(id) {
  return state.preferences[id] ?? {};
}

function reviewDue(id) {
  const at = preferenceFor(id).reviewAt;
  return Boolean(at && at <= Date.now());
}

function evidenceFor(extension) {
  return {
    trial: state.trials[extension.id] ?? null,
    workflow: state.workflowSignals[extension.id] ?? null,
    verdict: preferenceFor(extension.id).verdict ?? null,
    redundancy: state.redundancySignals[extension.id] ?? null,
    stateAgeDays: observedStateAgeDays(extension)
  };
}

function recommendationFor(extension) {
  return buildRecommendation(extension, evidenceFor(extension));
}

function priorityFor(extension) {
  let priority = attentionPriority(extension, evidenceFor(extension));
  if (reviewDue(extension.id)) priority += 12;
  if (state.alerts.some((alert) => !alert.seen && alert.extensionId === extension.id)) priority += 18;
  return priority;
}

function renderStats() {
  const evidence = Object.fromEntries(state.snapshot.extensions.map((extension) => [extension.id, evidenceFor(extension)]));
  const summary = portfolioSummary(state.snapshot.extensions, evidence);
  const unreadAlerts = state.alerts.filter((alert) => !alert.seen).length;
  const dueReviews = state.snapshot.extensions.filter((extension) => reviewDue(extension.id)).length;

  document.querySelector("#stats").innerHTML = [
    ["Installed", summary.installed],
    ["Enabled", summary.enabled],
    ["High exposure", summary.highExposureEnabled],
    ["Needs review", summary.needsReview],
    ["Strong cleanup evidence", summary.highConfidenceReviews],
    ["Access changes", unreadAlerts],
    ["Reviews due", dueReviews],
    ["Active trials", summary.activeTrials]
  ].map(([label, value]) => `<article><strong>${value}</strong><span>${label}</span></article>`).join("");
}

function matchesFilter(extension) {
  const recommendation = recommendationFor(extension);
  const trial = state.trials[extension.id];
  if (state.filter === "review") return recommendation.kind === "review";
  if (state.filter === "enabled") return extension.enabled;
  if (state.filter === "disabled") return !extension.enabled;
  if (state.filter === "high-access") return exposureAssessment(extension).level === "high";
  if (state.filter === "overlap") return Boolean(state.redundancySignals[extension.id]);
  if (state.filter === "trial") return Boolean(trial?.active || trial?.outcome);
  if (state.filter === "due-review") return reviewDue(extension.id);
  if (state.filter === "access-change") return state.alerts.some((alert) => !alert.seen && alert.extensionId === extension.id);
  return true;
}

function renderInventory() {
  const container = document.querySelector("#inventory");
  const query = state.query.trim().toLowerCase();
  const visible = state.snapshot.extensions
    .filter((extension) => {
      const text = `${extension.name} ${extension.shortName ?? ""} ${extension.description ?? ""} ${extension.id}`.toLowerCase();
      return (!query || text.includes(query)) && matchesFilter(extension);
    })
    .sort((a, b) => priorityFor(b) - priorityFor(a) || a.name.localeCompare(b.name));

  if (!visible.length) {
    container.innerHTML = `<div class="empty">No extensions match this view.</div>`;
    return;
  }

  container.innerHTML = visible.map(extensionCard).join("");
  container.querySelectorAll("[data-action]").forEach((button) => button.addEventListener("click", handleAction));
}

function extensionCard(extension) {
  const evidence = evidenceFor(extension);
  const recommendation = recommendationFor(extension);
  const confidence = decisionConfidence(extension, evidence);
  const exposure = exposureAssessment(extension);
  const hostSummary = summarizeHostAccess(extension.hostPermissions);
  const permissions = describePermissions(extension.permissions);
  const preference = preferenceFor(extension.id);
  const trial = state.trials[extension.id];
  const workflow = state.workflowSignals[extension.id];
  const redundancy = state.redundancySignals[extension.id];
  const unreadChange = state.alerts.some((alert) => !alert.seen && alert.extensionId === extension.id);
  const icon = [...(extension.icons ?? [])].sort((a, b) => b.size - a.size)[0]?.url ?? "";

  return `
    <article class="extension-card ${recommendation.kind === "review" ? "needs-review" : ""}" data-extension-id="${escapeHtml(extension.id)}">
      <div class="extension-main">
        <div class="identity">
          ${icon ? `<img src="${escapeHtml(icon)}" alt="" />` : `<div class="fallback-icon">${escapeHtml(extension.name.slice(0, 1).toUpperCase())}</div>`}
          <div>
            <div class="name-row">
              <h2>${escapeHtml(extension.name)}</h2>
              <span class="state ${extension.enabled ? "enabled" : "disabled"}">${extension.enabled ? "Enabled" : "Disabled"}</span>
              ${preference.verdict ? `<span class="verdict ${escapeHtml(preference.verdict)}">${escapeHtml(preference.verdict)}</span>` : ""}
              ${unreadChange ? `<span class="verdict change">access changed</span>` : ""}
              ${reviewDue(extension.id) ? `<span class="verdict due">review due</span>` : ""}
            </div>
            <p>${escapeHtml(extension.description || "No description provided.")}</p>
            <div class="meta">v${escapeHtml(extension.version)} · ${escapeHtml(extension.installType)} · observed state ${escapeHtml(formatDurationDays(observedStateAgeDays(extension)))}</div>
          </div>
        </div>
        <div class="decision">
          <span class="exposure ${exposure.level}">${exposure.level} exposure</span>
          <strong>${escapeHtml(recommendation.label)}</strong>
          <p>${escapeHtml(recommendation.reason)}</p>
          <small class="confidence">${escapeHtml(confidence.level)} decision confidence · ${escapeHtml(confidence.reasons.join(" · "))}</small>
        </div>
      </div>

      <details>
        <summary>Evidence, permissions, and controls</summary>
        <div class="details-grid">
          <section>
            <h3>Website scope</h3>
            <p class="muted">${escapeHtml(hostSummary.summary)}</p>
            ${hostSummary.fileAccessDeclared ? `<p class="callout">Declares file:// access. Chrome may still require the user to enable file URL access separately.</p>` : ""}
            ${tokenList(extension.hostPermissions)}
          </section>
          <section>
            <h3>Permission interpretation</h3>
            ${permissionList(permissions)}
          </section>
          <section>
            <h3>Workflow evidence</h3>
            ${workflowEvidence(workflow)}
          </section>
          <section>
            <h3>Cleanup experiment</h3>
            ${trialEvidence(trial)}
          </section>
          <section>
            <h3>Possible overlap</h3>
            ${redundancyEvidence(redundancy)}
          </section>
          <section>
            <h3>Your context</h3>
            <p class="muted">${preference.note ? escapeHtml(preference.note) : "No note explaining why you keep this extension."}</p>
            ${preference.reviewAt ? `<p class="muted">Review ${reviewDue(extension.id) ? "was due" : "scheduled"}: ${escapeHtml(formatDate(preference.reviewAt))}</p>` : ""}
          </section>
        </div>

        <div class="verdict-actions control-row">
          <span>Your verdict:</span>
          <button class="mini secondary" data-action="mark-essential" data-id="${extension.id}">Essential</button>
          <button class="mini secondary" data-action="mark-optional" data-id="${extension.id}">Optional</button>
          <button class="mini secondary" data-action="mark-unnecessary" data-id="${extension.id}">Unnecessary</button>
          <button class="mini secondary" data-action="add-note" data-id="${extension.id}">${preference.note ? "Edit note" : "Add note"}</button>
          <button class="mini secondary" data-action="review-30" data-id="${extension.id}">Review in 30d</button>
          ${preference.verdict || preference.note || preference.reviewAt ? `<button class="mini secondary" data-action="clear-context" data-id="${extension.id}">Clear context</button>` : ""}
        </div>

        <div class="card-actions">
          ${extension.enabled
            ? `<button data-action="trial-disable" data-id="${extension.id}" ${!extension.mayDisable ? "disabled" : ""}>Trial disable 7 days</button>`
            : `<button data-action="enable" data-id="${extension.id}" ${extension.mayEnable === false ? "disabled" : ""}>Enable</button>`}
          ${trial?.active ? `<button class="secondary" data-action="end-trial" data-id="${extension.id}">End trial</button>` : ""}
          <button class="danger secondary" data-action="uninstall" data-id="${extension.id}" ${!extension.mayDisable ? "disabled" : ""}>Uninstall…</button>
        </div>
      </details>
    </article>`;
}

function permissionList(items) {
  if (!items.length) return `<p class="muted">No API permissions declared in Chrome's installed-extension metadata.</p>`;
  return `<div class="permission-list">${items.map((item) => `
    <div class="permission-item sensitivity-${escapeHtml(item.sensitivity)}">
      <div><strong>${escapeHtml(item.title)}</strong><code>${escapeHtml(item.permission)}</code></div>
      <p>${escapeHtml(item.detail)}</p>
    </div>`).join("")}</div>`;
}

function tokenList(values) {
  if (!values?.length) return `<p class="muted">None declared.</p>`;
  return `<div class="tokens">${values.map((value) => `<code>${escapeHtml(value)}</code>`).join("")}</div>`;
}

function workflowEvidence(workflow) {
  if (!workflow) return `<p class="muted">Workflow relevance is off. No browsing history is required for base mode.</p>`;
  if (workflow.kind === "broad") return `<p class="muted">Broad website eligibility cannot distinguish actual usefulness, so Xtension deliberately does not count it as usage.</p>`;
  if (workflow.kind === "no-hosts") return `<p class="muted">No declared host patterns to compare with browsing context.</p>`;
  return `<p class="muted">${workflow.matchedPages} of ${workflow.totalRecentPages} recent history entries overlapped declared sites across ${workflow.matchedHosts} host${workflow.matchedHosts === 1 ? "" : "s"}. This is context evidence, not proof the extension executed.</p>`;
}

function trialEvidence(trial) {
  if (!trial) return `<p class="muted">No disable trial has been run.</p>`;
  if (trial.active) return `<p class="muted">Disabled experimentally until ${escapeHtml(formatDate(trial.plannedEndAt))}. Re-enabling it anywhere in Chrome is treated as strong dependency evidence.</p>`;
  if (trial.outcome === "survived-trial") return `<p class="muted">Completed the planned disable period without a recorded restore. Strong cleanup evidence.</p>`;
  if (trial.outcome === "needed") return `<p class="muted">Was restored during its disable trial. Strong evidence that your workflow depends on it.</p>`;
  if (trial.outcome === "uninstalled") return `<p class="muted">Was uninstalled during its disable trial.</p>`;
  return `<p class="muted">Previous trial outcome: ${escapeHtml(trial.outcome || trial.status || "unknown")}.</p>`;
}

function redundancyEvidence(redundancy) {
  if (!redundancy) return `<p class="muted">No conservative same-category overlap hint found.</p>`;
  return `<p class="muted">${escapeHtml(redundancy.reason)} Potential peers: ${escapeHtml(redundancy.peers.map((peer) => peer.name).join(", "))}.</p>`;
}

async function sendWorker(message) {
  const response = await chrome.runtime.sendMessage(message);
  if (response?.error) throw new Error(response.error);
  return response;
}

async function savePreference(id, patch, replace = false) {
  const current = replace ? {} : preferenceFor(id);
  const next = { ...current, ...patch, updatedAt: Date.now() };
  Object.keys(next).forEach((key) => next[key] == null && delete next[key]);
  if (Object.keys(next).filter((key) => key !== "updatedAt").length === 0) delete state.preferences[id];
  else state.preferences[id] = next;
  await chrome.storage.local.set({ [PREFERENCES_KEY]: state.preferences });
}

async function handleAction(event) {
  const button = event.currentTarget;
  const id = button.dataset.id;
  const action = button.dataset.action;
  const extension = state.snapshot.extensions.find((item) => item.id === id);
  if (!extension) return;

  try {
    button.disabled = true;
    if (action === "trial-disable") await sendWorker({ type: "trial:start", extensionId: id, days: 7 });
    if (action === "enable") await sendWorker({ type: "extension:enable", extensionId: id });
    if (action === "end-trial") await sendWorker({ type: "trial:end", extensionId: id, outcome: "ended-manually" });
    if (action === "uninstall") await sendWorker({ type: "extension:uninstall", extensionId: id });
    if (action === "mark-essential") await savePreference(id, { verdict: "essential" });
    if (action === "mark-optional") await savePreference(id, { verdict: "optional" });
    if (action === "mark-unnecessary") await savePreference(id, { verdict: "unnecessary" });
    if (action === "review-30") await savePreference(id, { reviewAt: Date.now() + 30 * 24 * 60 * 60 * 1000 });
    if (action === "add-note") {
      const note = prompt(`Why do you keep ${extension.name}?`, preferenceFor(id).note ?? "");
      if (note !== null) await savePreference(id, { note: note.trim() || null });
    }
    if (action === "clear-context") await savePreference(id, {}, true);

    await loadInventory(["trial-disable", "enable", "uninstall"].includes(action));
    showNotice(actionMessage(action, extension.name));
  } catch (error) {
    showNotice(error?.message || "Chrome did not complete that action.", true);
  } finally {
    button.disabled = false;
  }
}

function actionMessage(action, name) {
  const messages = {
    "trial-disable": `${name} entered a seven-day disable trial.`,
    enable: `${name} was enabled.`,
    "end-trial": `Trial ended for ${name}; Chrome state was not silently changed.`,
    uninstall: `${name} was removed after Chrome confirmation.`,
    "mark-essential": `${name} marked essential.`,
    "mark-optional": `${name} marked optional.`,
    "mark-unnecessary": `${name} marked unnecessary.`,
    "review-30": `${name} scheduled for review in 30 days.`,
    "add-note": `Local context updated for ${name}.`,
    "clear-context": `Local context cleared for ${name}.`
  };
  return messages[action] ?? `${name} updated.`;
}

async function loadWorkflowSignals() {
  const granted = await chrome.permissions.contains({ permissions: ["history"] });
  if (!granted) {
    state.workflowSignals = {};
    return;
  }
  const historyItems = await chrome.history.search({
    text: "",
    startTime: Date.now() - HISTORY_WINDOW_DAYS * 24 * 60 * 60 * 1000,
    maxResults: 5000
  });
  state.workflowSignals = deriveWorkflowSignals(state.snapshot.extensions, historyItems.map((item) => item.url || ""));
}

function renderAlerts() {
  const section = document.querySelector("#alertsSection");
  const container = document.querySelector("#alerts");
  const unread = state.alerts.filter((alert) => !alert.seen);
  section.hidden = !unread.length;
  container.innerHTML = unread.map((alert) => `
    <article class="alert-card severity-${escapeHtml(alert.severity)}">
      <div class="alert-meta">${escapeHtml(alert.severity)} · ${escapeHtml(relativeTime(alert.at))}</div>
      <strong>${escapeHtml(alert.summary)}</strong>
      ${alert.detail ? `<p>${escapeHtml(alert.detail)}</p>` : ""}
    </article>`).join("");
}

function renderTimeline() {
  const container = document.querySelector("#timeline");
  const events = state.timeline.slice(0, 50);
  if (!events.length) {
    container.innerHTML = `<div class="empty">No local changes recorded yet.</div>`;
    return;
  }
  container.innerHTML = events.map((event) => `
    <article class="timeline-event kind-${escapeHtml(event.kind)}">
      <div class="timeline-dot"></div>
      <div>
        <div class="timeline-meta">${escapeHtml(relativeTime(event.at))} · ${escapeHtml(event.kind.replaceAll("-", " "))}</div>
        <strong>${escapeHtml(event.summary)}</strong>
        ${event.detail ? `<p>${escapeHtml(event.detail)}</p>` : ""}
      </div>
    </article>`).join("");
}

async function loadInventory(force = false) {
  state.snapshot = await sendWorker({ type: force ? "inventory:refresh" : "inventory:get" });
  state.trials = await sendWorker({ type: "trials:get" });
  state.timeline = await sendWorker({ type: "timeline:get" });
  state.alerts = await sendWorker({ type: "alerts:get" });
  const stored = await chrome.storage.local.get(PREFERENCES_KEY);
  state.preferences = stored[PREFERENCES_KEY] ?? {};
  state.redundancySignals = findPotentialRedundancies(state.snapshot.extensions);
  await loadWorkflowSignals();
  renderStats();
  renderAlerts();
  renderInventory();
  renderTimeline();
}

async function configureHistoryButton() {
  const button = document.querySelector("#historyButton");
  async function syncLabel() {
    const granted = await chrome.permissions.contains({ permissions: ["history"] });
    button.textContent = granted ? "Disable workflow relevance" : "Enable workflow relevance";
    button.classList.toggle("active", granted);
    return granted;
  }
  await syncLabel();
  button.addEventListener("click", async () => {
    try {
      const granted = await chrome.permissions.contains({ permissions: ["history"] });
      if (granted) {
        await chrome.permissions.remove({ permissions: ["history"] });
        state.workflowSignals = {};
        await syncLabel();
        renderInventory();
        showNotice("Workflow relevance disabled. Xtension no longer has history permission.");
      } else {
        const accepted = await chrome.permissions.request({ permissions: ["history"] });
        if (accepted) {
          await loadWorkflowSignals();
          await syncLabel();
          renderInventory();
          showNotice("Workflow relevance enabled. Recent URLs were compared locally and were not persisted by Xtension.");
        }
      }
    } catch (error) {
      showNotice(error?.message || "Could not change workflow-relevance permission.", true);
    }
  });
}

async function exportLocalState() {
  const payload = {
    exportedAt: new Date().toISOString(),
    schema: "xtension-local-export-v1",
    note: "No raw browsing history is included.",
    inventory: state.snapshot,
    trials: state.trials,
    preferences: state.preferences,
    alerts: state.alerts,
    timeline: state.timeline
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `xtension-local-export-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  showNotice("Local Xtension evidence exported. Raw browsing history was not included.");
}

function formatDate(timestamp) {
  return timestamp ? new Date(timestamp).toLocaleString() : "unknown";
}

function formatDurationDays(days) {
  if (!Number.isFinite(days) || days < 1 / 24) return "<1h";
  if (days < 1) return `${Math.max(1, Math.floor(days * 24))}h`;
  return `${Math.floor(days)}d`;
}

function relativeTime(timestamp) {
  if (!timestamp) return "unknown time";
  const minutes = Math.floor(Math.max(0, Date.now() - timestamp) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return days < 30 ? `${days}d ago` : new Date(timestamp).toLocaleDateString();
}

function showNotice(message, error = false) {
  const notice = document.querySelector("#notice");
  notice.hidden = false;
  notice.textContent = message;
  notice.classList.toggle("error", error);
}

document.querySelector("#refreshButton").addEventListener("click", () => loadInventory(true));
document.querySelector("#exportButton").addEventListener("click", exportLocalState);
document.querySelector("#searchInput").addEventListener("input", (event) => {
  state.query = event.target.value;
  renderInventory();
});
document.querySelector("#filterSelect").addEventListener("change", (event) => {
  state.filter = event.target.value;
  renderInventory();
});
document.querySelector("#markAlertsButton").addEventListener("click", async () => {
  try {
    state.alerts = await sendWorker({ type: "alerts:mark-seen" });
    renderStats();
    renderAlerts();
    renderInventory();
    showNotice("Access changes marked reviewed. They remain in the local timeline.");
  } catch (error) {
    showNotice(error?.message || "Could not mark alerts reviewed.", true);
  }
});

await configureHistoryButton();
await loadInventory();
