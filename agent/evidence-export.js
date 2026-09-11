import { LOCAL_EVIDENCE_KEYS, buildLocalEvidenceExport } from "./export-policy.js";

const button = document.querySelector("#exportButton");

async function exportEvidence(event) {
  event.preventDefault();
  event.stopImmediatePropagation();
  if (!button) return;

  const priorLabel = button.textContent;
  button.disabled = true;
  button.textContent = "Preparing export…";

  try {
    const stored = await chrome.storage.local.get(Object.values(LOCAL_EVIDENCE_KEYS));
    const payload = buildLocalEvidenceExport(stored);
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `xtension-local-evidence-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    button.textContent = "Exported locally";
  } catch (error) {
    button.textContent = error?.message || "Export failed";
  } finally {
    setTimeout(() => {
      button.disabled = false;
      button.textContent = priorLabel;
    }, 1400);
  }
}

if (button) {
  button.textContent = "Export full local evidence";
  button.addEventListener("click", exportEvidence, { capture: true });
}
