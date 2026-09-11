const auditButton = document.querySelector("#auditButton");
if (auditButton) {
  auditButton.addEventListener("click", () => {
    location.href = chrome.runtime.getURL("audit.html");
  });
}
