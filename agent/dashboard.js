const HISTORY_WINDOW_DAYS = 30;

const state = {
  snapshot: { observedAt: 0, extensions: [] },
  trials: {},
  timeline: [],
  workflowSignals: {},
  query: "",
  filter: "all"
};

const sensitivePermissions = new Set([
  "history",
  "cookies",
  "webRequest",
  "debugger",
  "nativeMessaging",
  "clipboardRead",
  "management",
  "scripting"
]);

function hasBroadHostAccess(extension) {
  return extension.hostPermissions.some(
    (pattern) => pattern === "<all_urls>" || pattern.includes("*://*/*")
  );
}

function exposureLevel(extension) {
  const sensitive = extension.permissions.filter((permission) => sensitivePermissions.has(permission)).length;
  const broad = hasBroadHostAccess(extension);
  if (broad || sensitive >= 2) return "high";
  if (sensitive === 1 || extension.hostPermissions.length > 5) return "medium";
  return "low";
}

function recommendation(extension) {
  const trial = state.trials[extension.id];
  const workflow = state.workflowSignals[extension.id];
  const exposure = exposureLevel(extension);

  if (trial?.active) {
    return {
      label: "Trial disabled",
      kind: "trial",
      reason: "Testing whether your workflow actually depends on it. Xtension will not remove it automatically."
    };
  }

  if (trial?.outcome === "survived-trial") {
    return {
      label: "Trial passed — consider removal",
      kind: "review",
      reason: "The planned disable trial completed without Xtension recording a restore. That is strong cleanup evidence, not absolute proof of uselessness."
    };
  }

  if (trial?.outcome === "needed") {
    return {
      label: "Keep — workflow dependency observed",
      kind: "keep",
      reason: "You restored this extension during a disable trial, which is strong evidence that it matters to your workflow."
    };
  }

  if (!extension.enabled) {
    return {
      label: "Review for removal",
      kind: "review",
      reason: exposure === "high"
        ? "It is already disabled but has a high access surface when enabled. This is a strong review candidate."
        : "It is already disabled. Xtension will not assume that means unused, but it deserves review."
    };
  }

  if (workflow?.kind === "no-overlap") {
    return {
      label: "Trial-disable candidate",
      kind: "review",
      reason: `No recent page overlap found in the last ${HISTORY_WINDOW_DAYS} days for its declared sites. This is context evidence, not proof of non-use.`
    };
  }

  if (exposure === "high") {
    return {
      label: "Review access",
      kind: "review",
      reason: "This extension has broad or sensitive capabilities. Keep it only if the workflow value justifies that access."
    };
  }

  if (workflow?.kind === "overlap") {
    return {
      label: "Context overlap detected",
      kind: "neutral",
      reason: `Its declared sites overlapped ${workflow.matchedHosts} recently visited host${workflow.matchedHosts === 1 ? "" : "s"}. This does not prove the extension executed.`
    };
  }

  return {
    label: "Assess relevance",
    kind: "neutral",
    reason: "No strong keep/remove evidence yet."
  };
}

function attentionPriority(extension) {
  const trial = state.trials[extension.id];
  const workflow = state.workflowSignals[extension.id];
  const exposure = exposureLevel(extension);

  if (trial?.outcome === "survived-trial") return 100;
  if (!extension.enabled && exposure === "high") return 96;
  if (workflow?.kind === "no-overlap" && exposure === "high") return 92;
  if (workflow?.kind === "no-overlap") return 86;
  if (exposure === "high") return 78;
  if (!extension.enabled) return 72;
  if (trial?.active) return 68;
  if (exposure === "medium") return 48;
  if (trial?.outcome === "needed") return 18;
  return 30;
}

function iconFor(extension) {
  const icons = [...(extension.icons ?? [])].sort((a, b) => b.size - a.size);
  return icons[0]?.url ?? "";
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function renderStats() {
  const extensions = state.snapshot.extensions;
  const enabled = extensions.filter((item) => item.enabled).length;
  const disabled = extensions.length - enabled;
  const highAccess = extensions.filter((item) => exposureLevel(item) === "high").length;
  const trials = Object.values(state.trials).filter((trial) => trial.active).length;
  const reviews = extensions.filter((item) => recommendation(item).kind === "review").length;

  document.querySelector("#stats").innerHTML = [
    ["Installed", extensions.length],
    ["Enabled", enabled],
    ["Disabled", disabled],
    ["High access", highAccess],
    ["Needs review", reviews],
    ["Trials", trials]
  ]
    .map(([label, value]) => `<article><strong>${value}</strong><span>${label}</span></article>`)
    .join("");
}

function matchesFilter(extension) {
  if (state.filter === "enabled") return extension.enabled;
  if (state.filter === "disabled") return !extension.enabled;
  if (state.filter === "high-access") return exposureLevel(extension) === "high";
  if (state.filter === "review") return recommendation(extension).kind === "review";
  if (state.filter === "trial") {
    const trial = state.trials[extension.id];
    return Boolean(trial?.active || trial?.outcome === "survived-trial");
  }
  return true;
}

function renderInventory() {
  const container = document.querySelector("#inventory");
  const query = state.query.trim().toLowerCase();

  const visible = state.snapshot.extensions
    .filter((extension) => {
      const textMatch = !query || `${extension.name} ${extension.description} ${extension.id}`.toLowerCase().includes(query);
      return textMatch && matchesFilter(extension);
    })
    .sort((a, b) => attentionPriority(b) - attentionPriority(a) || a.name.localeCompare(b.name));

  if (visible.length === 0) {
    container.innerHTML = `<div class="empty">No extensions match this view.</div>`;
    return;
  }

  container.innerHTML = visible.map(extensionCard).join("");

  for (const button of container.querySelectorAll("[data-action]")) {
    button.addEventListener("click", handleAction);
  }
}

function extensionCard(extension) {
  const exposure = exposureLevel(extension);
  const rec = recommendation(extension);
  const trial = state.trials[extension.id];
  const workflow = state.workflowSignals[extension.id];
  const icon = iconFor(extension);
  const permissionSummary = `${extension.permissions.length} API · ${extension.hostPermissions.length} host`;
  const priority = attentionPriority(extension);

  return `
    <article class="extension-card ${rec.kind === "review" ? "needs-review" : ""}" data-extension-id="${escapeHtml(extension.id)}">
      <div class="extension-main">
        <div class="identity">
          ${icon ? `<img src="${escapeHtml(icon)}" alt="" />` : `<div class="fallback-icon">${escapeHtml(extension.name.slice(0, 1).toUpperCase())}</div>`}
          <div>
            <div class="name-row">
              <h2>${escapeHtml(extension.name)}</h2>
              <span class="state ${extension.enabled ? "enabled" : "disabled"}">${extension.enabled ? "Enabled" : "Disabled"}</span>
            </div>
            <p>${escapeHtml(extension.description || "No description provided.")}</p>
            <div class="meta">v${escapeHtml(extension.version)} · ${escapeHtml(extension.installType)} · ${permissionSummary} · attention ${priority}</div>
          </div>
        </div>
        <div class="decision">
          <span class="exposure ${exposure}">${exposure} access</span>
          <strong>${escapeHtml(rec.label)}</strong>
          <p>${escapeHtml(rec.reason)}</p>
        </div>
      </div>

      <details>
        <summary>Evidence and controls</summary>
        <div class="details-grid">
          <section>
            <h3>API permissions</h3>
            ${tokenList(extension.permissions)}
          </section>
          <section>
            <h3>Website access</h3>
            ${tokenList(extension.hostPermissions)}
          </section>
          <section>
            <h3>Workflow relevance evidence</h3>
            ${workflowEvidence(workflow)}
          </section>
          <section>
            <h3>Trial evidence</h3>
            ${trialEvidence(trial)}
          </section>
          <section>
            <h3>State evidence</h3>
            <p class="muted">${extension.enabled ? "Currently enabled." : `Currently disabled${extension.disabledReason ? ` (${escapeHtml(extension.disabledReason)})` : ""}.`} Install type: ${escapeHtml(extension.installType)}.</p>
          </section>
        </div>
        <div class="card-actions">
          ${extension.enabled
            ? `<button data-action="trial-disable" data-id="${extension.id}" ${!extension.mayDisable ? "disabled" : ""}>Trial disable 7 days</button>`
            : `<button data-action="enable" data-id="${extension.id}" ${extension.mayEnable === false ? "disabled" : ""}>Enable</button>`}
          ${trial?.active ? `<button class="secondary" data-action="end-trial" data-id="${extension.id}">End trial</button>` : ""}
          <button class="danger secondary" data-action="uninstall" data-id="${extension.id}" ${!extension.mayDisable ? "disabled" : ""}>Uninstall…</button>
        </div>
      </details>
    </article>
  `;
}

function workflowEvidence(workflow) {
  if (!workflow) {
    return `<p class="muted">Workflow mode is off or this extension has no usable host-access signal.</p>`;
  }
  if (workflow.kind === "broad") {
    return `<p class="muted">This extension declares broad web access, so site overlap cannot distinguish usefulness. Xtension will not treat broad eligibility as usage.</p>`;
  }
  if (workflow.kind === "no-hosts") {
    return `<p class="muted">No declared host permissions to compare with recent browsing. Relevance must come from other evidence.</p>`;
  }
  return `<p class="muted">${workflow.matchedPages} of ${workflow.totalRecentPages} recent history entries matched its declared sites across ${workflow.matchedHosts} host${workflow.matchedHosts === 1 ? "" : "s"}. This is opportunity/context evidence only.</p>`;
}

function trialEvidence(trial) {
  if (!trial) return `<p class="muted">No cleanup trial has been run.</p>`;
  if (trial.active) {
    return `<p class="muted">Trial active since ${escapeHtml(formatDate(trial.startedAt))}. Planned end: ${escapeHtml(formatDate(trial.plannedEndAt))}.</p>`;
  }
  if (trial.outcome === "survived-trial") {
    return `<p class="muted">The disable trial completed without a recorded restore. This is strong evidence for removal review.</p>`;
  }
  if (trial.outcome === "needed") {
    return `<p class="muted">This extension was restored before its disable trial completed. Treat that as strong evidence of workflow dependency.</p>`;
  }
  return `<p class="muted">Previous trial outcome: ${escapeHtml(trial.outcome || trial.status || "unknown")}.</p>`;
}

function tokenList(values) {
  if (!values?.length) return `<p class="muted">None declared.</p>`;
  return `<div class="tokens">${values.map((value) => `<code>${escapeHtml(value)}</code>`).join("")}</div>`;
}

function parseWebUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url;
  } catch {
    return null;
  }
}

function hostPatternMatchesUrl(pattern, url) {
  if (pattern === "<all_urls>" || pattern.includes("*://*/*")) return true;

  const match = pattern.match(/^(\*|https?|http):\/\/([^/]+)\//i);
  if (!match) return false;

  const scheme = match[1].toLowerCase();
  const hostPattern = match[2].toLowerCase();
  if (scheme !== "*" && `${scheme}:` !== url.protocol) return false;
  if (hostPattern === "*") return true;

  if (hostPattern.startsWith("*.")) {
    const root = hostPattern.slice(2);
    return url.hostname === root || url.hostname.endsWith(`.${root}`);
  }

  return url.hostname === hostPattern;
}

async function loadWorkflowSignals() {
  const granted = await chrome.permissions.contains({ permissions: ["history"] });
  if (!granted) {
    state.workflowSignals = {};
    return;
  }

  const startTime = Date.now() - HISTORY_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  const historyItems = await chrome.history.search({
    text: "",
    startTime,
    maxResults: 5000
  });

  const recentPages = historyItems
    .map((item) => parseWebUrl(item.url || ""))
    .filter(Boolean);

  const signals = {};
  for (const extension of state.snapshot.extensions) {
    if (!extension.hostPermissions.length) {
      signals[extension.id] = { kind: "no-hosts", totalRecentPages: recentPages.length, matchedPages: 0, matchedHosts: 0 };
      continue;
    }

    if (hasBroadHostAccess(extension)) {
      signals[extension.id] = {
        kind: "broad",
        totalRecentPages: recentPages.length,
        matchedPages: recentPages.length,
        matchedHosts: new Set(recentPages.map((url) => url.hostname)).size
      };
      continue;
    }

    const matching = recentPages.filter((url) =>
      extension.hostPermissions.some((pattern) => hostPatternMatchesUrl(pattern, url))
    );
    const matchedHosts = new Set(matching.map((url) => url.hostname)).size;

    signals[extension.id] = {
      kind: matching.length > 0 ? "overlap" : "no-overlap",
      totalRecentPages: recentPages.length,
      matchedPages: matching.length,
      matchedHosts
    };
  }

  // Raw browsing history and URL lists are deliberately not persisted or uploaded.
  state.workflowSignals = signals;
}

async function sendWorker(message) {
  const response = await chrome.runtime.sendMessage(message);
  if (response?.error) throw new Error(response.error);
  return response;
}

async function handleAction(event) {
  const button = event.currentTarget;
  const id = button.dataset.id;
  const action = button.dataset.action;
  const extension = state.snapshot.extensions.find((item) => item.id === id);
  if (!extension) return;

  try {
    button.disabled = true;

    if (action === "trial-disable") {
      await sendWorker({ type: "trial:start", extensionId: id, days: 7 });
      showNotice(`${extension.name} is trial-disabled for seven days. Restore it if your workflow breaks.`);
    }

    if (action === "enable") {
      await sendWorker({ type: "extension:enable", extensionId: id });
      showNotice(`${extension.name} was enabled.`);
    }

    if (action === "end-trial") {
      await sendWorker({ type: "trial:end", extensionId: id, outcome: "ended-manually" });
      showNotice(`Trial ended for ${extension.name}. The extension remains in its current Chrome state.`);
    }

    if (action === "uninstall") {
      await sendWorker({ type: "extension:uninstall", extensionId: id });
      showNotice(`${extension.name} was removed.`);
    }

    await loadInventory(true);
  } catch (error) {
    showNotice(error?.message || "Chrome did not complete that action.", true);
  } finally {
    button.disabled = false;
  }
}

function renderTimeline() {
  const container = document.querySelector("#timeline");
  const events = state.timeline.slice(0, 40);
  if (!events.length) {
    container.innerHTML = `<div class="empty">No changes recorded yet. Xtension starts learning your extension system from this installation onward.</div>`;
    return;
  }

  container.innerHTML = events
    .map((event) => `
      <article class="timeline-event kind-${escapeHtml(event.kind)}">
        <div class="timeline-dot"></div>
        <div>
          <div class="timeline-meta">${escapeHtml(relativeTime(event.at))} · ${escapeHtml(event.kind.replaceAll("-", " "))}</div>
          <strong>${escapeHtml(event.summary)}</strong>
          ${event.detail ? `<p>${escapeHtml(event.detail)}</p>` : ""}
        </div>
      </article>
    `)
    .join("");
}

async function loadInventory(force = false) {
  state.snapshot = await sendWorker({ type: force ? "inventory:refresh" : "inventory:get" });
  state.trials = await sendWorker({ type: "trials:get" });
  state.timeline = await sendWorker({ type: "timeline:get" });
  await loadWorkflowSignals();
  renderStats();
  renderInventory();
  renderTimeline();
}

async function configureHistoryButton() {
  const button = document.querySelector("#historyButton");
  const granted = await chrome.permissions.contains({ permissions: ["history"] });
  button.textContent = granted ? "Workflow relevance enabled" : "Enable workflow relevance";
  button.classList.toggle("active", granted);

  button.addEventListener("click", async () => {
    try {
      const alreadyGranted = await chrome.permissions.contains({ permissions: ["history"] });
      if (alreadyGranted) {
        await loadWorkflowSignals();
        renderStats();
        renderInventory();
        showNotice("Workflow relevance is enabled. Raw browsing history remains local to this browser agent.");
        return;
      }

      const accepted = await chrome.permissions.request({ permissions: ["history"] });
      if (accepted) {
        button.textContent = "Workflow relevance enabled";
        button.classList.add("active");
        await loadWorkflowSignals();
        renderStats();
        renderInventory();
        showNotice("Workflow relevance enabled. Xtension compared recent browsing locally against declared extension sites; raw history was not stored or uploaded.");
      }
    } catch (error) {
      showNotice(error?.message || "Could not request history permission.", true);
    }
  });
}

function formatDate(timestamp) {
  if (!timestamp) return "unknown";
  return new Date(timestamp).toLocaleString();
}

function relativeTime(timestamp) {
  if (!timestamp) return "unknown time";
  const delta = Math.max(0, Date.now() - timestamp);
  const minutes = Math.floor(delta / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(timestamp).toLocaleDateString();
}

function showNotice(message, isError = false) {
  const notice = document.querySelector("#notice");
  notice.hidden = false;
  notice.textContent = message;
  notice.classList.toggle("error", isError);
}

document.querySelector("#refreshButton").addEventListener("click", () => loadInventory(true));
document.querySelector("#searchInput").addEventListener("input", (event) => {
  state.query = event.target.value;
  renderInventory();
});
document.querySelector("#filterSelect").addEventListener("change", (event) => {
  state.filter = event.target.value;
  renderInventory();
});

await configureHistoryButton();
await loadInventory();
