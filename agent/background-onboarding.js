chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason !== "install") return;
  void chrome.tabs.create({ url: chrome.runtime.getURL("onboarding.html") }).catch((error) =>
    console.error("Xtension onboarding failed to open", error)
  );
});
