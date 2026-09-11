import { observedStateAgeDays } from "./core.js";
import { cleanupImpact, cleanupImpactNarrative } from "./cleanup-impact.js";

const INVENTORY_KEY = "xtension.inventory.v1";
const TRIALS_KEY = "xtension.trials.v1";
const PREFERENCES_KEY = "xtension.preferences.v1";

async function renderImpact() {
  const container = document.querySelector("#cleanupImpact");
  if (!container) return;

  const stored = await chrome.storage.local.get([INVENTORY_KEY, TRIALS_KEY, PREFERENCES_KEY]);
  const snapshot = stored[INVENTORY_KEY] ?? { extensions: [] };
  const trials = stored[TRIALS_KEY] ?? {};
  const preferences = stored[PREFERENCES_KEY] ?? {};
  const evidence = Object.fromEntries((snapshot.extensions ?? []).map((extension) => [
    extension.id,
    {
      trial: trials[extension.id] ?? null,
      verdict: preferences[extension.id]?.verdict ?? null,
      stateAgeDays: observedStateAgeDays(extension)
    }
  ]));
  const impact = cleanupImpact(snapshot.extensions ?? [], evidence);

  container.innerHTML = `
    <div class="impact-copy">
      <div class="eyebrow">POTENTIAL CLEANUP IMPACT</div>
      <h2>Reduce access only where the evidence supports it.</h2>
      <p>${escapeHtml(cleanupImpactNarrative(impact))}</p>
    </div>
    <div class="impact-metrics">
      <article><strong>${impact.enabledHighExposure}</strong><span>enabled high-exposure</span></article>
      <article><strong>${impact.candidateHighExposure}</strong><span>high-exposure review candidates</span></article>
      <article><strong>${impact.candidateBroadHostAccess}</strong><span>broad-access candidates</span></article>
      <article><strong>${impact.candidateSensitivePermissionGrants}</strong><span>sensitive grants in candidates</span></article>
    </div>`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local") return;
  if (changes[INVENTORY_KEY] || changes[TRIALS_KEY] || changes[PREFERENCES_KEY]) void renderImpact();
});

await renderImpact();
