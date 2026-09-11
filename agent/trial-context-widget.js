const TRIALS_KEY = "xtension.trials.v1";

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function getTrials() {
  const stored = await chrome.storage.local.get(TRIALS_KEY);
  return stored[TRIALS_KEY] ?? {};
}

async function annotate(extensionId, existingReason = "") {
  const reason = prompt(
    "What broke or became inconvenient while this extension was disabled? Keep it concrete so Xtension can remember the dependency.",
    existingReason
  );
  if (reason === null) return;
  const response = await chrome.runtime.sendMessage({ type: "trial:annotate", extensionId, reason });
  if (response?.error) throw new Error(response.error);
}

async function render() {
  const trials = await getTrials();
  document.querySelectorAll(".extension-card[data-extension-id]").forEach((card) => {
    const extensionId = card.dataset.extensionId;
    const trial = trials[extensionId];
    const existing = card.querySelector("[data-trial-context]");

    if (trial?.outcome !== "needed") {
      existing?.remove();
      return;
    }

    const target = card.querySelector("details");
    if (!target) return;
    const reason = trial.dependencyReason ?? "";
    const block = existing ?? document.createElement("section");
    block.dataset.trialContext = "true";
    block.className = "trial-context-block";
    block.innerHTML = `
      <h3>Observed workflow dependency</h3>
      <p class="muted">${reason
        ? `You restored this extension because: ${escapeHtml(reason)}`
        : "This extension was restored during a disable trial. Add the concrete reason so Xtension can preserve useful workflow evidence instead of merely remembering that it was re-enabled."}</p>
      <button class="mini secondary" data-trial-context-action="annotate">${reason ? "Edit restore reason" : "Add restore reason"}</button>`;

    if (!existing) target.append(block);
    block.querySelector("[data-trial-context-action]")?.addEventListener("click", async () => {
      const button = block.querySelector("[data-trial-context-action]");
      try {
        button.disabled = true;
        await annotate(extensionId, reason);
        await render();
      } catch (error) {
        console.error("Xtension could not save trial context", error);
      } finally {
        button.disabled = false;
      }
    }, { once: true });
  });
}

const observer = new MutationObserver(() => void render());
observer.observe(document.querySelector("#inventory"), { childList: true, subtree: false });

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "local" && changes[TRIALS_KEY]) void render();
});

await render();
