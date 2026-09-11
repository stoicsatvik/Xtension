import { realizedImpact, realizedImpactNarrative } from "./realized-impact.js";

const INVENTORY_KEY = "xtension.inventory.v1";
const TRIALS_KEY = "xtension.trials.v1";
const REMOVED_KEY = "xtension.removed.v1";

function ensureContainer() {
  let container = document.querySelector("#realizedImpact");
  if (container) return container;
  container = document.createElement("section");
  container.id = "realizedImpact";
  container.className = "realized-impact";
  document.querySelector("#cleanupImpact")?.insertAdjacentElement("afterend", container);
  return container;
}

async function render() {
  const stored = await chrome.storage.local.get([INVENTORY_KEY, TRIALS_KEY, REMOVED_KEY]);
  const impact = realizedImpact({
    extensions: stored[INVENTORY_KEY]?.extensions ?? [],
    trials: stored[TRIALS_KEY] ?? {},
    removedExtensions: stored[REMOVED_KEY] ?? []
  });

  const container = ensureContainer();
  container.innerHTML = `
    <div class="realized-copy">
      <div class="eyebrow">OBSERVED OUTCOMES</div>
      <h2>What actually changed</h2>
      <p>${realizedImpactNarrative(impact)}</p>
    </div>
    <div class="realized-stats">
      <article><strong>${impact.observedRemovals}</strong><span>observed removals</span></article>
      <article><strong>${impact.removedBroadHostAccess}</strong><span>removed with broad access</span></article>
      <article><strong>${impact.restoredDuringTrial}</strong><span>dependencies found</span></article>
      <article><strong>${impact.survivedTrials}</strong><span>trials survived</span></article>
      <article><strong>${impact.currentlyDisabledHighExposure}</strong><span>high-exposure currently disabled</span></article>
    </div>`;
}

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local") return;
  if (![INVENTORY_KEY, TRIALS_KEY, REMOVED_KEY].some((key) => changes[key])) return;
  void render();
});

await render();
