const INVENTORY_SELECTOR = "#inventory";

function addLongTrialButtons() {
  const inventory = document.querySelector(INVENTORY_SELECTOR);
  if (!inventory) return;

  inventory.querySelectorAll('[data-action="trial-disable"]').forEach((shortButton) => {
    const id = shortButton.dataset.id;
    if (!id || shortButton.parentElement?.querySelector(`[data-action="trial-disable-30"][data-id="${CSS.escape(id)}"]`)) return;

    const longButton = document.createElement("button");
    longButton.className = "secondary";
    longButton.dataset.action = "trial-disable-30";
    longButton.dataset.id = id;
    longButton.textContent = "Trial disable 30 days";
    longButton.title = "A longer observation window is better for monthly or infrequent workflows.";
    if (shortButton.disabled) longButton.disabled = true;
    shortButton.insertAdjacentElement("afterend", longButton);
  });
}

async function startLongTrial(button) {
  const extensionId = button.dataset.id;
  if (!extensionId) return;

  button.disabled = true;
  const originalText = button.textContent;
  button.textContent = "Starting 30-day trial…";

  try {
    const response = await chrome.runtime.sendMessage({
      type: "trial:start",
      extensionId,
      days: 30
    });
    if (response?.error) throw new Error(response.error);

    // Reload through the normal dashboard bootstrap so all decision evidence,
    // trial UI, stats and timeline are recomputed from the shared source of truth.
    location.reload();
  } catch (error) {
    button.disabled = false;
    button.textContent = originalText;
    const notice = document.querySelector("#notice");
    if (notice) {
      notice.hidden = false;
      notice.textContent = error?.message || "Chrome did not start the 30-day trial.";
      notice.classList.add("error");
    }
  }
}

document.addEventListener("click", (event) => {
  const target = event.target instanceof Element
    ? event.target.closest('[data-action="trial-disable-30"]')
    : null;
  if (!(target instanceof HTMLButtonElement)) return;
  event.preventDefault();
  event.stopPropagation();
  void startLongTrial(target);
});

const inventory = document.querySelector(INVENTORY_SELECTOR);
if (inventory) {
  new MutationObserver(addLongTrialButtons).observe(inventory, { childList: true, subtree: true });
}
addLongTrialButtons();
