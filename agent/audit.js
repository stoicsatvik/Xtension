import {
  HISTORY_WINDOW_DAYS,
  attentionPriority,
  buildRecommendation,
  deriveWorkflowSignals,
  exposureAssessment,
  findPotentialRedundancies,
  observedStateAgeDays
} from "./core.js";
import { decisionConfidence } from "./decision-intelligence.js";

const PREFERENCES_KEY = "xtension.preferences.v1";

const state = {
  snapshot: { observedAt: 0, extensions: [] },
  trials: {},
  preferences: {},
  workflowSignals: {},
  redundancySignals: {},
  queue: [],
  index: 0,
  decisions: 0,
  skipped: new Set()
};

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function sendWorker(message) {
  return chrome.runtime.sendMessage(message).then((response) => {
    if (response?.error) throw new Error(response.error);
    return response;
  });
}

function preferenceFor(id) {
  return state.preferences[id] ?? {};
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

function priorityFor(extension) {
  return attentionPriority(extension, evidenceFor(extension));
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
  state.workflowSignals = deriveWorkflowSignals(
    state.snapshot.extensions,
    historyItems.map((item) => item.url || "")
  );
}

function rebuildQueue({ preserveCurrent = false } = {}) {
  const currentId = preserveCurrent ? state.queue[state.index]?.id : null;
  state.redundancySignals = findPotentialRedundancies(state.snapshot.extensions);
  state.queue = [...state.snapshot.extensions]
    .filter((extension) => !state.skipped.has(extension.id))
    .sort((a, b) => priorityFor(b) - priorityFor(a) || a.name.localeCompare(b.name));

  if (currentId) {
    const nextIndex = state.queue.findIndex((extension) => extension.id === currentId);
    state.index = nextIndex >= 0 ? nextIndex : Math.min(state.index, Math.max(0, state.queue.length - 1));
  } else {
    state.index = Math.min(state.index, Math.max(0, state.queue.length - 1));
  }
}

function workflowEvidence(workflow) {
  if (!workflow) return "Workflow mode is off; no browsing history is needed for this audit.";
  if (workflow.kind === "broad") return "Broad website eligibility cannot prove actual use, so Xtension deliberately ignores it as usage evidence.";
  if (workflow.kind === "no-hosts") return "No declared host patterns are available for browsing-context comparison.";
  if (workflow.kind === "no-overlap") return `No recent history entry overlapped its declared sites in the last ${HISTORY_WINDOW_DAYS} days. This is weak context evidence, not proof of non-use.`;
  return `${workflow.matchedPages} recent history entries overlapped declared sites across ${workflow.matchedHosts} host${workflow.matchedHosts === 1 ? "" : "s"}. This is context evidence, not proof it executed.`;
}

function trialEvidence(trial) {
  if (!trial) return "No disable experiment has been run yet.";
  if (trial.active) return `A reversible disable trial is active until ${new Date(trial.plannedEndAt).toLocaleDateString()}.`;
  if (trial.outcome === "needed") return "It was restored during a disable trial, which is strong dependency evidence.";
  if (trial.outcome === "survived-trial") return "It completed a disable period without a recorded restore. Confidence depends on the trial duration.";
  if (trial.outcome === "uninstalled") return "It was removed during a previous disable trial.";
  return `Previous trial outcome: ${trial.outcome || trial.status || "unknown"}.`;
}

function redundancyEvidence(signal) {
  if (!signal) return "No conservative same-category overlap hint found.";
  return `${signal.reason} Peers: ${signal.peers.map((peer) => peer.name).join(", ")}.`;
}

function render() {
  const card = document.querySelector("#auditCard");
  const complete = document.querySelector("#completeCard");
  const progressLabel = document.querySelector("#progressLabel");
  const decisionCount = document.querySelector("#decisionCount");
  const progressBar = document.querySelector("#progressBar");

  if (!state.queue.length || state.index >= state.queue.length) {
    card.hidden = true;
    complete.hidden = false;
    progressLabel.textContent = "Audit complete";
    decisionCount.textContent = `${state.decisions} decisions`;
    progressBar.style.width = "100%";
    complete.innerHTML = `
      <h2>Audit complete.</h2>
      <p>You reviewed this queue without Xtension silently changing anything. Decisions and notes stay in local extension storage.</p>
      <div class="audit-summary">
        <article><strong>${state.decisions}</strong><span>decisions made</span></article>
        <article><strong>${Object.values(state.preferences).filter((item) => item.verdict === "essential").length}</strong><span>marked essential</span></article>
        <article><strong>${Object.values(state.preferences).filter((item) => item.verdict === "unnecessary").length}</strong><span>marked unnecessary</span></article>
      </div>
      <button id="finishButton">Return to dashboard</button>`;
    document.querySelector("#finishButton").addEventListener("click", () => location.href = "dashboard.html");
    return;
  }

  card.hidden = false;
  complete.hidden = true;
  const extension = state.queue[state.index];
  const evidence = evidenceFor(extension);
  const recommendation = buildRecommendation(extension, evidence);
  const confidence = decisionConfidence(extension, evidence);
  const exposure = exposureAssessment(extension);
  const preference = preferenceFor(extension.id);
  const icon = [...(extension.icons ?? [])].sort((a, b) => b.size - a.size)[0]?.url ?? "";
  const progress = state.queue.length ? ((state.index + 1) / state.queue.length) * 100 : 100;

  progressLabel.textContent = `Extension ${state.index + 1} of ${state.queue.length}`;
  decisionCount.textContent = `${state.decisions} decisions made`;
  progressBar.style.width = `${progress}%`;

  card.innerHTML = `
    <div class="audit-identity">
      ${icon ? `<img src="${escapeHtml(icon)}" alt="" />` : `<div class="fallback-icon">${escapeHtml(extension.name.slice(0, 1).toUpperCase())}</div>`}
      <div>
        <h2>${escapeHtml(extension.name)}</h2>
        <p>${escapeHtml(extension.description || "No description provided.")}</p>
        <div class="audit-meta">${extension.enabled ? "Enabled" : "Disabled"} · v${escapeHtml(extension.version)} · ${escapeHtml(extension.installType)}</div>
      </div>
    </div>

    <div class="audit-decision">
      <span class="exposure ${escapeHtml(exposure.level)}">${escapeHtml(exposure.level)} exposure</span>
      <div>
        <strong>${escapeHtml(recommendation.label)}</strong>
        <p>${escapeHtml(recommendation.reason)}</p>
        <div class="audit-confidence">${escapeHtml(confidence.level)} confidence · ${escapeHtml(confidence.reasons.join(" · "))}</div>
      </div>
    </div>

    <div class="audit-evidence">
      <article><strong>Capability exposure</strong><p>${escapeHtml(exposure.reasons.length ? exposure.reasons.join(" · ") : "No broad or mapped sensitive capability signal found.")}</p></article>
      <article><strong>Workflow context</strong><p>${escapeHtml(workflowEvidence(evidence.workflow))}</p></article>
      <article><strong>Disable experiment</strong><p>${escapeHtml(trialEvidence(evidence.trial))}</p></article>
      <article><strong>Potential overlap</strong><p>${escapeHtml(redundancyEvidence(evidence.redundancy))}</p></article>
    </div>

    <div class="audit-actions">
      <button class="secondary ${preference.verdict === "essential" ? "current" : ""}" data-audit-action="essential">Essential</button>
      <button class="secondary ${preference.verdict === "optional" ? "current" : ""}" data-audit-action="optional">Optional</button>
      <button class="secondary ${preference.verdict === "unnecessary" ? "current" : ""}" data-audit-action="unnecessary">Unnecessary</button>
      <span class="spacer"></span>
      ${extension.enabled && extension.mayDisable ? `<button class="secondary" data-audit-action="trial-7">Trial 7d</button><button class="secondary" data-audit-action="trial-30">Trial 30d</button>` : ""}
      <button class="secondary" data-audit-action="skip">Skip</button>
    </div>`;

  card.querySelectorAll("[data-audit-action]").forEach((button) => button.addEventListener("click", handleAction));
}

async function saveVerdict(extensionId, verdict) {
  const current = preferenceFor(extensionId);
  state.preferences[extensionId] = {
    ...current,
    verdict,
    updatedAt: Date.now()
  };
  await chrome.storage.local.set({ [PREFERENCES_KEY]: state.preferences });
}

async function refreshState() {
  state.snapshot = await sendWorker({ type: "inventory:refresh" });
  state.trials = await sendWorker({ type: "trials:get" });
  const stored = await chrome.storage.local.get(PREFERENCES_KEY);
  state.preferences = stored[PREFERENCES_KEY] ?? {};
  await loadWorkflowSignals();
  rebuildQueue();
}

async function handleAction(event) {
  const button = event.currentTarget;
  const action = button.dataset.auditAction;
  const extension = state.queue[state.index];
  if (!extension) return;

  try {
    cardBusy(true);

    if (["essential", "optional", "unnecessary"].includes(action)) {
      await saveVerdict(extension.id, action);
      state.decisions += 1;
      state.skipped.add(extension.id);
    } else if (action === "trial-7" || action === "trial-30") {
      const days = action === "trial-30" ? 30 : 7;
      await sendWorker({ type: "trial:start", extensionId: extension.id, days });
      state.decisions += 1;
      state.skipped.add(extension.id);
      showNotice(`${extension.name} entered a ${days}-day reversible disable trial.`);
    } else if (action === "skip") {
      state.skipped.add(extension.id);
    }

    state.index = 0;
    state.trials = await sendWorker({ type: "trials:get" });
    state.snapshot = await sendWorker({ type: "inventory:get" });
    rebuildQueue();
    render();
  } catch (error) {
    showNotice(error?.message || "Chrome did not complete that action.", true);
  } finally {
    cardBusy(false);
  }
}

function cardBusy(busy) {
  document.querySelectorAll("[data-audit-action]").forEach((button) => {
    button.disabled = busy;
  });
}

function showNotice(message, error = false) {
  const notice = document.querySelector("#notice");
  notice.hidden = false;
  notice.textContent = message;
  notice.classList.toggle("error", error);
}

document.querySelector("#backButton").addEventListener("click", () => location.href = "dashboard.html");

await refreshState();
render();
