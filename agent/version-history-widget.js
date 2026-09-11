const VERSION_HISTORY_KEY = "xtension.version-history.v1";

let historyById = {};

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function arrayDelta(previous = [], current = []) {
  return {
    added: current.filter((value) => !previous.includes(value)),
    removed: previous.filter((value) => !current.includes(value))
  };
}

function changeDescription(previous, current) {
  if (!previous) return "First locally observed access snapshot.";
  const parts = [];
  if (previous.version !== current.version) parts.push(`${previous.version ?? "?"} → ${current.version ?? "?"}`);

  const permissionDelta = arrayDelta(previous.permissions, current.permissions);
  const hostDelta = arrayDelta(previous.hostPermissions, current.hostPermissions);
  if (permissionDelta.added.length) parts.push(`+ API: ${permissionDelta.added.join(", ")}`);
  if (permissionDelta.removed.length) parts.push(`- API: ${permissionDelta.removed.join(", ")}`);
  if (hostDelta.added.length) parts.push(`+ sites: ${hostDelta.added.join(", ")}`);
  if (hostDelta.removed.length) parts.push(`- sites: ${hostDelta.removed.join(", ")}`);
  return parts.length ? parts.join(" · ") : "No package-access change in this observation.";
}

function renderHistory(extensionId) {
  const observations = historyById[extensionId] ?? [];
  if (!observations.length) {
    return `<p class="muted">No local version/access history yet. Xtension begins observing from installation onward.</p>`;
  }

  return `<div class="version-history-list">${observations.slice(-5).map((current, index, visible) => {
    const absoluteIndex = Math.max(0, observations.length - 5) + index;
    const previous = absoluteIndex > 0 ? observations[absoluteIndex - 1] : null;
    return `
      <article class="version-history-item">
        <div><strong>v${escapeHtml(current.version ?? "?")}</strong><span>${escapeHtml(new Date(current.observedAt).toLocaleDateString())}</span></div>
        <p>${escapeHtml(changeDescription(previous, current))}</p>
      </article>`;
  }).join("")}</div>`;
}

function decorateCards() {
  document.querySelectorAll(".extension-card[data-extension-id]").forEach((card) => {
    const extensionId = card.dataset.extensionId;
    const grid = card.querySelector(".details-grid");
    if (!extensionId || !grid) return;

    let section = grid.querySelector('[data-version-history="true"]');
    if (!section) {
      section = document.createElement("section");
      section.dataset.versionHistory = "true";
      section.innerHTML = `<h3>Local access history</h3><div data-version-history-body></div>`;
      grid.append(section);
    }
    const body = section.querySelector("[data-version-history-body]");
    if (body) body.innerHTML = renderHistory(extensionId);
  });
}

async function loadHistory() {
  const stored = await chrome.storage.local.get(VERSION_HISTORY_KEY);
  historyById = stored[VERSION_HISTORY_KEY] ?? {};
  decorateCards();
}

const inventory = document.querySelector("#inventory");
if (inventory) new MutationObserver(decorateCards).observe(inventory, { childList: true, subtree: true });

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local" || !changes[VERSION_HISTORY_KEY]) return;
  historyById = changes[VERSION_HISTORY_KEY].newValue ?? {};
  decorateCards();
});

await loadHistory();
