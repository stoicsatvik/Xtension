const ALERT_SELECTOR = "#alerts .alert-card";

async function sendWorker(message) {
  const response = await chrome.runtime.sendMessage(message);
  if (response?.error) throw new Error(response.error);
  return response;
}

async function decorateAlerts() {
  const container = document.querySelector("#alerts");
  if (!container) return;

  const alerts = await sendWorker({ type: "alerts:get" });
  const unread = alerts.filter((alert) => !alert.seen);
  const cards = [...document.querySelectorAll(ALERT_SELECTOR)];

  cards.forEach((card, index) => {
    const alert = unread[index];
    if (!alert || card.querySelector("[data-review-alert]")) return;

    const actions = document.createElement("div");
    actions.className = "alert-actions";
    const button = document.createElement("button");
    button.className = "mini secondary";
    button.textContent = "Mark this reviewed";
    button.dataset.reviewAlert = alert.alertId;
    button.addEventListener("click", async () => {
      button.disabled = true;
      try {
        await sendWorker({ type: "alerts:mark-seen", alertIds: [alert.alertId] });
        location.reload();
      } catch (error) {
        button.disabled = false;
        button.textContent = error?.message || "Could not review alert";
      }
    });
    actions.append(button);
    card.append(actions);
  });
}

const alertsRoot = document.querySelector("#alerts");
if (alertsRoot) {
  const observer = new MutationObserver(() => void decorateAlerts());
  observer.observe(alertsRoot, { childList: true });
}

await decorateAlerts();
