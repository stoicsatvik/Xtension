const CATALOG = {
  activeTab: {
    sensitivity: "low",
    title: "Temporary current-tab access",
    detail: "Lets the extension access the current tab after an explicit user gesture. It does not by itself grant persistent access to every website."
  },
  tabs: {
    sensitivity: "medium",
    title: "Tab metadata",
    detail: "Can expose privileged tab fields such as URL and title in contexts Chrome permits."
  },
  history: {
    sensitivity: "high",
    title: "Browsing history",
    detail: "Can read and change the browser's recorded browsing history."
  },
  cookies: {
    sensitivity: "high",
    title: "Cookies",
    detail: "Can use Chrome's cookies API. Actual cookie access also depends on the extension's granted host access."
  },
  bookmarks: {
    sensitivity: "medium",
    title: "Bookmarks",
    detail: "Can read and modify browser bookmarks."
  },
  downloads: {
    sensitivity: "medium",
    title: "Downloads",
    detail: "Can create, inspect, and manage downloads through Chrome's downloads API."
  },
  clipboardRead: {
    sensitivity: "high",
    title: "Read clipboard",
    detail: "Can read data from the system clipboard in supported extension contexts."
  },
  clipboardWrite: {
    sensitivity: "medium",
    title: "Write clipboard",
    detail: "Can place data onto the system clipboard."
  },
  scripting: {
    sensitivity: "high",
    title: "Script injection",
    detail: "Can inject JavaScript or CSS into pages where the extension also has the required host access or temporary activeTab access."
  },
  webRequest: {
    sensitivity: "high",
    title: "Observe network requests",
    detail: "Can observe network requests within its permitted host scope. Browser policy limits which request modifications are allowed."
  },
  declarativeNetRequest: {
    sensitivity: "medium",
    title: "Network filtering rules",
    detail: "Can apply declarative rules that block, redirect, or modify supported network requests."
  },
  debugger: {
    sensitivity: "high",
    title: "Chrome debugging protocol",
    detail: "Can attach Chrome's debugging protocol to supported browser targets, a particularly powerful capability."
  },
  nativeMessaging: {
    sensitivity: "high",
    title: "Native application bridge",
    detail: "Can communicate with approved native applications installed on the computer."
  },
  management: {
    sensitivity: "high",
    title: "Manage extensions",
    detail: "Can inspect and manage installed Chrome extensions and apps."
  },
  geolocation: {
    sensitivity: "high",
    title: "Location",
    detail: "Can request geolocation information through supported browser APIs."
  },
  identity: {
    sensitivity: "medium",
    title: "Identity / OAuth",
    detail: "Can use Chrome identity flows to obtain supported authentication tokens for the extension."
  },
  webNavigation: {
    sensitivity: "medium",
    title: "Navigation events",
    detail: "Can observe browser navigation events, subject to Chrome's extension access rules."
  },
  storage: {
    sensitivity: "low",
    title: "Extension storage",
    detail: "Can store extension-owned data using Chrome's storage API."
  },
  unlimitedStorage: {
    sensitivity: "low",
    title: "Expanded extension storage",
    detail: "Allows extension storage beyond normal quota limits where Chrome supports it."
  },
  notifications: {
    sensitivity: "low",
    title: "Notifications",
    detail: "Can create browser/system notifications."
  },
  contextMenus: {
    sensitivity: "low",
    title: "Context menus",
    detail: "Can add commands to Chrome context menus."
  },
  alarms: {
    sensitivity: "low",
    title: "Scheduled background work",
    detail: "Can schedule extension tasks to run later."
  },
  idle: {
    sensitivity: "medium",
    title: "Idle state",
    detail: "Can detect whether the computer is active, idle, or locked."
  },
  sidePanel: {
    sensitivity: "low",
    title: "Side panel",
    detail: "Can provide UI in Chrome's side panel."
  }
};

const SENSITIVITY_ORDER = { high: 4, medium: 3, low: 2, unknown: 1 };

export function describePermission(permission) {
  const known = CATALOG[permission];
  if (known) return { permission, known: true, ...known };
  return {
    permission,
    known: false,
    sensitivity: "unknown",
    title: permission,
    detail: "Xtension has not mapped this Chrome permission yet. It is shown without inferring capabilities."
  };
}

export function describePermissions(permissions = []) {
  return [...new Set(permissions)]
    .map(describePermission)
    .sort((a, b) =>
      SENSITIVITY_ORDER[b.sensitivity] - SENSITIVITY_ORDER[a.sensitivity] || a.permission.localeCompare(b.permission)
    );
}

export function summarizeHostAccess(patterns = []) {
  const unique = [...new Set(patterns)];
  const broadPatterns = unique.filter((pattern) => pattern === "<all_urls>" || pattern.includes("*://*/*"));
  const filePatterns = unique.filter((pattern) => pattern.startsWith("file://"));
  const wildcardDomains = unique.filter((pattern) => /:\/\/\*\./.test(pattern));

  let level = "none";
  let summary = "No declared persistent website host access.";
  if (unique.length) {
    level = "scoped";
    summary = `Access is declared for ${unique.length} host pattern${unique.length === 1 ? "" : "s"}.`;
  }
  if (wildcardDomains.length) {
    level = "multi-site";
    summary = `${wildcardDomains.length} wildcard domain pattern${wildcardDomains.length === 1 ? "" : "s"} can cover multiple subdomains.`;
  }
  if (broadPatterns.length) {
    level = "broad";
    summary = "The extension declares broad website access. This describes capability scope, not proof that page data is collected.";
  }

  return {
    level,
    summary,
    patternCount: unique.length,
    broadPatterns,
    wildcardDomains,
    fileAccessDeclared: filePatterns.length > 0
  };
}
