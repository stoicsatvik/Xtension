export const HISTORY_WINDOW_DAYS = 30;

export const SENSITIVE_PERMISSIONS = new Set([
  "history",
  "cookies",
  "webRequest",
  "debugger",
  "nativeMessaging",
  "clipboardRead",
  "management",
  "scripting"
]);

const CATEGORY_RULES = [
  ["password-manager", ["password manager", "passwords", "bitwarden", "lastpass", "1password", "dashlane"]],
  ["ad-blocker", ["ad blocker", "adblock", "ublock", "adguard", "block ads"]],
  ["vpn-proxy", ["vpn", "proxy server", "secure proxy"]],
  ["coupon-shopping", ["coupon", "cashback", "shopping rewards", "honey"]],
  ["grammar-writing", ["grammar", "grammarly", "writing assistant", "spell checker"]],
  ["screenshot", ["screenshot", "screen capture", "capture screen"]],
  ["tab-management", ["tab manager", "manage tabs", "tab suspender", "suspend tabs"]],
  ["dark-mode", ["dark mode", "dark reader", "night mode"]],
  ["translation", ["translator", "translate page", "translation"]],
  ["ai-assistant", ["ai assistant", "chatgpt", "claude", "gemini", "copilot"]]
];

export function hasBroadHostAccess(extension) {
  return (extension.hostPermissions ?? []).some(
    (pattern) => pattern === "<all_urls>" || pattern.includes("*://*/*")
  );
}

export function exposureAssessment(extension) {
  const permissions = extension.permissions ?? [];
  const hostPermissions = extension.hostPermissions ?? [];
  const sensitive = permissions.filter((permission) => SENSITIVE_PERMISSIONS.has(permission));
  const broad = hasBroadHostAccess(extension);
  const reasons = [];

  if (broad) reasons.push("broad website access");
  if (sensitive.length) reasons.push(`sensitive APIs: ${sensitive.join(", ")}`);
  if (!broad && hostPermissions.length > 5) reasons.push(`${hostPermissions.length} declared host patterns`);

  let level = "low";
  if (broad || sensitive.length >= 2) level = "high";
  else if (sensitive.length === 1 || hostPermissions.length > 5) level = "medium";

  return {
    level,
    reasons,
    sensitivePermissions: sensitive,
    broadHostAccess: broad,
    hostPatternCount: hostPermissions.length
  };
}

export function exposureLevel(extension) {
  return exposureAssessment(extension).level;
}

export function parseWebUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url;
  } catch {
    return null;
  }
}

export function hostPatternMatchesUrl(pattern, url) {
  if (pattern === "<all_urls>" || pattern.includes("*://*/*")) return true;

  const match = pattern.match(/^(\*|https?|http):\/\/([^/]+)\//i);
  if (!match) return false;

  const scheme = match[1].toLowerCase();
  const hostPattern = match[2].toLowerCase();
  if (scheme !== "*" && `${scheme}:` !== url.protocol) return false;
  if (hostPattern === "*") return true;

  if (hostPattern.startsWith("*.")) {
    const root = hostPattern.slice(2);
    return url.hostname === root || url.hostname.endsWith(`.${root}`);
  }

  return url.hostname === hostPattern;
}

export function deriveWorkflowSignals(extensions, historyUrls) {
  const recentPages = historyUrls
    .map((value) => (value instanceof URL ? value : parseWebUrl(value)))
    .filter(Boolean);

  const signals = {};
  for (const extension of extensions) {
    const hostPermissions = extension.hostPermissions ?? [];

    if (!hostPermissions.length) {
      signals[extension.id] = {
        kind: "no-hosts",
        totalRecentPages: recentPages.length,
        matchedPages: 0,
        matchedHosts: 0
      };
      continue;
    }

    if (hasBroadHostAccess(extension)) {
      signals[extension.id] = {
        kind: "broad",
        totalRecentPages: recentPages.length,
        matchedPages: recentPages.length,
        matchedHosts: new Set(recentPages.map((url) => url.hostname)).size
      };
      continue;
    }

    const matching = recentPages.filter((url) =>
      hostPermissions.some((pattern) => hostPatternMatchesUrl(pattern, url))
    );

    signals[extension.id] = {
      kind: matching.length > 0 ? "overlap" : "no-overlap",
      totalRecentPages: recentPages.length,
      matchedPages: matching.length,
      matchedHosts: new Set(matching.map((url) => url.hostname)).size
    };
  }

  return signals;
}

function searchableText(extension) {
  return `${extension.name ?? ""} ${extension.shortName ?? ""} ${extension.description ?? ""}`.toLowerCase();
}

export function inferCategory(extension) {
  const text = searchableText(extension);
  for (const [category, needles] of CATEGORY_RULES) {
    if (needles.some((needle) => text.includes(needle))) return category;
  }
  return null;
}

export function findPotentialRedundancies(extensions) {
  const byCategory = new Map();

  for (const extension of extensions) {
    if (!extension.enabled) continue;
    const category = inferCategory(extension);
    if (!category) continue;
    const list = byCategory.get(category) ?? [];
    list.push(extension);
    byCategory.set(category, list);
  }

  const evidence = {};
  for (const [category, items] of byCategory) {
    if (items.length < 2) continue;
    for (const item of items) {
      evidence[item.id] = {
        category,
        peers: items.filter((other) => other.id !== item.id).map((other) => ({ id: other.id, name: other.name })),
        confidence: "low",
        reason: `Multiple enabled extensions appear to serve the ${category.replaceAll("-", " ")} category. This is a review hint, not proof of redundancy.`
      };
    }
  }

  return evidence;
}

export function buildRecommendation(extension, evidence = {}) {
  const { trial = null, workflow = null, verdict = null, redundancy = null } = evidence;
  const exposure = exposureLevel(extension);

  if (trial?.active) {
    return {
      label: "Trial disabled",
      kind: "trial",
      reason: "Testing whether your workflow actually depends on it. Xtension will not remove it automatically."
    };
  }

  if (trial?.outcome === "survived-trial") {
    return {
      label: "Trial passed — consider removal",
      kind: "review",
      reason: "The planned disable trial completed without Xtension recording a restore. That is strong cleanup evidence, not absolute proof of uselessness."
    };
  }

  if (trial?.outcome === "needed") {
    return {
      label: "Keep — workflow dependency observed",
      kind: "keep",
      reason: "You restored this extension during a disable trial, which is strong evidence that it matters to your workflow."
    };
  }

  if (verdict === "essential") {
    return {
      label: exposure === "high" ? "Keep — essential, monitor access" : "Keep — marked essential",
      kind: "keep",
      reason: exposure === "high"
        ? "You marked it essential, but its access surface is broad enough to keep under review when permissions change."
        : "You explicitly marked this extension essential."
    };
  }

  if (verdict === "unnecessary") {
    return {
      label: extension.enabled ? "Trial-disable now" : "Remove candidate",
      kind: "review",
      reason: "You marked this extension unnecessary. Xtension still requires a deliberate user action before disabling or removing it."
    };
  }

  if (!extension.enabled) {
    return {
      label: "Review for removal",
      kind: "review",
      reason: exposure === "high"
        ? "It is already disabled but has a high access surface when enabled. This is a strong review candidate."
        : "It is already disabled. Xtension will not assume that means unused, but it deserves review."
    };
  }

  if (workflow?.kind === "no-overlap") {
    return {
      label: "Trial-disable candidate",
      kind: "review",
      reason: `No recent page overlap found in the last ${HISTORY_WINDOW_DAYS} days for its declared sites. This is context evidence, not proof of non-use.`
    };
  }

  if (exposure === "high") {
    return {
      label: verdict === "optional" ? "Optional + high access — review" : "Review access",
      kind: "review",
      reason: verdict === "optional"
        ? "You marked it optional and it has broad or sensitive capabilities, making it a good cleanup-test candidate."
        : "This extension has broad or sensitive capabilities. Keep it only if the workflow value justifies that access."
    };
  }

  if (redundancy && verdict !== "essential") {
    return {
      label: "Possible overlap — compare",
      kind: "review",
      reason: redundancy.reason
    };
  }

  if (verdict === "optional") {
    return {
      label: "Optional",
      kind: "neutral",
      reason: "You marked this extension optional. Xtension will surface stronger evidence if its relevance or access changes."
    };
  }

  if (workflow?.kind === "overlap") {
    return {
      label: "Context overlap detected",
      kind: "neutral",
      reason: `Its declared sites overlapped ${workflow.matchedHosts} recently visited host${workflow.matchedHosts === 1 ? "" : "s"}. This does not prove the extension executed.`
    };
  }

  return {
    label: "Assess relevance",
    kind: "neutral",
    reason: "No strong keep/remove evidence yet."
  };
}

export function attentionPriority(extension, evidence = {}) {
  const { trial = null, workflow = null, verdict = null, redundancy = null } = evidence;
  const exposure = exposureLevel(extension);

  if (trial?.outcome === "survived-trial") return 100;
  if (verdict === "unnecessary" && exposure === "high") return 99;
  if (verdict === "unnecessary") return 97;
  if (!extension.enabled && exposure === "high") return 96;
  if (workflow?.kind === "no-overlap" && exposure === "high") return 92;
  if (verdict === "optional" && exposure === "high") return 90;
  if (workflow?.kind === "no-overlap") return 86;
  if (exposure === "high") return verdict === "essential" ? 60 : 78;
  if (!extension.enabled) return 72;
  if (trial?.active) return 68;
  if (redundancy && verdict !== "essential") return 56;
  if (exposure === "medium") return verdict === "essential" ? 22 : 48;
  if (trial?.outcome === "needed" || verdict === "essential") return 12;
  if (verdict === "optional") return 36;
  return 30;
}
