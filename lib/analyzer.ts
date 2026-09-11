import JSZip from "jszip";

export type Severity = "low" | "medium" | "high";

export type Capability = {
  title: string;
  detail: string;
  severity: Severity;
  source: string;
};

export type StaticSignal = {
  label: string;
  matches: number;
};

export type AnalysisReport = {
  id: string;
  name: string;
  version: string;
  manifestVersion: number | null;
  permissions: string[];
  optionalPermissions: string[];
  hostPermissions: string[];
  optionalHostPermissions: string[];
  contentScriptMatches: string[];
  capabilities: Capability[];
  staticSignals: StaticSignal[];
  externalHosts: string[];
  package: {
    compressedBytes: number;
    fileCount: number;
    jsFilesScanned: number;
  };
  disclaimer: string;
};

type ExtensionManifest = {
  name?: string;
  version?: string;
  manifest_version?: number;
  permissions?: string[];
  optional_permissions?: string[];
  host_permissions?: string[];
  optional_host_permissions?: string[];
  content_scripts?: Array<{ matches?: string[]; js?: string[] }>;
};

const EXTENSION_ID_RE = /^[a-p]{32}$/;
const MAX_PACKAGE_BYTES = 25 * 1024 * 1024;
const MAX_FILES = 2_000;
const MAX_JS_FILE_CHARS = 1_000_000;
const MAX_TOTAL_SCANNED_CHARS = 6_000_000;

export function extractExtensionId(input: string): string | null {
  const value = input.trim().toLowerCase();
  if (EXTENSION_ID_RE.test(value)) return value;

  try {
    const url = new URL(value);
    const allowedHosts = new Set(["chromewebstore.google.com", "chrome.google.com"]);
    if (!allowedHosts.has(url.hostname)) return null;

    const segments = url.pathname.split("/").filter(Boolean);
    const candidate = [...segments].reverse().find((part) => EXTENSION_ID_RE.test(part));
    return candidate ?? null;
  } catch {
    return null;
  }
}

export function chromeUpdateUrl(id: string): string {
  if (!EXTENSION_ID_RE.test(id)) throw new Error("Invalid Chrome extension ID.");
  const x = encodeURIComponent(`id=${id}&uc`);
  return `https://clients2.google.com/service/update2/crx?response=redirect&prodversion=140.0.0.0&acceptformat=crx3&x=${x}`;
}

export function stripCrxHeader(input: Uint8Array): Uint8Array {
  if (input.length < 4) throw new Error("Package is too small to be a CRX/ZIP file.");
  if (input[0] === 0x50 && input[1] === 0x4b) return input;

  const magic = String.fromCharCode(...input.slice(0, 4));
  if (magic !== "Cr24") throw new Error("Unsupported package format.");
  if (input.length < 12) throw new Error("Malformed CRX header.");

  const view = new DataView(input.buffer, input.byteOffset, input.byteLength);
  const version = view.getUint32(4, true);

  if (version === 3) {
    const headerSize = view.getUint32(8, true);
    const offset = 12 + headerSize;
    if (offset >= input.length) throw new Error("Malformed CRX3 header.");
    return input.slice(offset);
  }

  if (version === 2) {
    if (input.length < 16) throw new Error("Malformed CRX2 header.");
    const publicKeyLength = view.getUint32(8, true);
    const signatureLength = view.getUint32(12, true);
    const offset = 16 + publicKeyLength + signatureLength;
    if (offset >= input.length) throw new Error("Malformed CRX2 header.");
    return input.slice(offset);
  }

  throw new Error(`Unsupported CRX version: ${version}`);
}

const PERMISSION_CAPABILITIES: Record<string, Omit<Capability, "source">> = {
  tabs: {
    title: "Can inspect tab metadata",
    detail: "The extension requests the tabs API, which can expose tab metadata such as URLs and titles in permitted contexts.",
    severity: "medium",
  },
  history: {
    title: "Can access browsing history",
    detail: "The extension requests access to the browser history API.",
    severity: "high",
  },
  cookies: {
    title: "Can use the cookies API",
    detail: "The extension requests the cookies API. Actual cookie access also depends on granted host access.",
    severity: "high",
  },
  downloads: {
    title: "Can interact with downloads",
    detail: "The extension requests the downloads API.",
    severity: "medium",
  },
  bookmarks: {
    title: "Can access bookmarks",
    detail: "The extension requests the bookmarks API.",
    severity: "medium",
  },
  clipboardRead: {
    title: "Can read clipboard data",
    detail: "The extension requests clipboard read access.",
    severity: "high",
  },
  clipboardWrite: {
    title: "Can write clipboard data",
    detail: "The extension requests clipboard write access.",
    severity: "medium",
  },
  management: {
    title: "Can inspect installed extensions",
    detail: "The extension requests the management API for information about installed extensions/apps.",
    severity: "medium",
  },
  webRequest: {
    title: "Can observe network requests",
    detail: "The extension requests the webRequest API. Effective scope depends on host permissions and browser policy.",
    severity: "high",
  },
  declarativeNetRequest: {
    title: "Can apply network request rules",
    detail: "The extension requests declarative network request capabilities.",
    severity: "medium",
  },
  scripting: {
    title: "Can inject scripts in permitted pages",
    detail: "The extension requests the scripting API. Injection still requires appropriate host access or user-granted access.",
    severity: "high",
  },
  debugger: {
    title: "Can use Chrome debugging protocol access",
    detail: "The extension requests debugger access, a powerful capability that can inspect and control browser targets.",
    severity: "high",
  },
  nativeMessaging: {
    title: "Can communicate with native applications",
    detail: "The extension requests native messaging access to approved native hosts on the device.",
    severity: "high",
  },
  geolocation: {
    title: "Can request location",
    detail: "The extension requests geolocation access.",
    severity: "high",
  },
  storage: {
    title: "Can store extension data",
    detail: "The extension requests Chrome extension storage.",
    severity: "low",
  },
  notifications: {
    title: "Can create notifications",
    detail: "The extension requests browser notification access.",
    severity: "low",
  },
};

const STATIC_RULES: Array<{ label: string; pattern: RegExp }> = [
  { label: "Cookies API reference", pattern: /(?:chrome|browser)\.cookies\b/g },
  { label: "History API reference", pattern: /(?:chrome|browser)\.history\b/g },
  { label: "Tabs API reference", pattern: /(?:chrome|browser)\.tabs\b/g },
  { label: "WebRequest API reference", pattern: /(?:chrome|browser)\.webRequest\b/g },
  { label: "Scripting API reference", pattern: /(?:chrome|browser)\.scripting\b/g },
  { label: "Runtime external messaging reference", pattern: /(?:onMessageExternal|externally_connectable)/g },
  { label: "fetch() reference", pattern: /\bfetch\s*\(/g },
  { label: "XMLHttpRequest reference", pattern: /\bXMLHttpRequest\b/g },
  { label: "WebSocket reference", pattern: /\bWebSocket\s*\(/g },
  { label: "eval-like reference", pattern: /\beval\s*\(/g },
];

function countMatches(text: string, pattern: RegExp): number {
  return text.match(pattern)?.length ?? 0;
}

function normalizeManifestStrings(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  return values.filter((value): value is string => typeof value === "string");
}

function buildCapabilities(
  permissions: string[],
  hostPermissions: string[],
  contentScriptMatches: string[],
): Capability[] {
  const capabilities: Capability[] = [];

  for (const permission of permissions) {
    const definition = PERMISSION_CAPABILITIES[permission];
    if (definition) capabilities.push({ ...definition, source: `permission:${permission}` });
  }

  const allHostPatterns = [...hostPermissions, ...contentScriptMatches];
  if (allHostPatterns.includes("<all_urls>")) {
    capabilities.push({
      title: "Can run on or access all website origins",
      detail: "The required manifest access includes <all_urls>. The exact actions possible still depend on the extension's APIs and code.",
      severity: "high",
      source: "host:<all_urls>",
    });
  } else if (allHostPatterns.some((pattern) => pattern.includes("*://*/*"))) {
    capabilities.push({
      title: "Requests broad website access",
      detail: "The required manifest access includes a wildcard host pattern covering a very broad set of websites.",
      severity: "high",
      source: "host:wildcard",
    });
  } else if (allHostPatterns.length > 0) {
    capabilities.push({
      title: `Requests access to ${allHostPatterns.length} declared host pattern${allHostPatterns.length === 1 ? "" : "s"}`,
      detail: "Required host permissions and content-script match patterns define which sites the extension can interact with automatically or directly.",
      severity: allHostPatterns.length > 10 ? "medium" : "low",
      source: "host:declared",
    });
  }

  return capabilities;
}

function extractExternalHosts(text: string): string[] {
  const hosts = new Set<string>();
  const urlPattern = /https?:\/\/([a-z0-9.-]+\.[a-z]{2,})(?=[/:?#"'`\s)]|$)/gi;
  for (const match of text.matchAll(urlPattern)) {
    const host = match[1]?.toLowerCase();
    if (!host) continue;
    hosts.add(host);
    if (hosts.size >= 100) break;
  }
  return [...hosts].sort();
}

export async function analyzePackage(id: string, crxBytes: Uint8Array): Promise<AnalysisReport> {
  if (crxBytes.byteLength > MAX_PACKAGE_BYTES) {
    throw new Error(`Package exceeds ${MAX_PACKAGE_BYTES / 1024 / 1024} MB analysis limit.`);
  }

  const zipBytes = stripCrxHeader(crxBytes);
  const zip = await JSZip.loadAsync(zipBytes);
  const files = Object.values(zip.files).filter((entry) => !entry.dir);
  if (files.length > MAX_FILES) throw new Error(`Package contains more than ${MAX_FILES} files.`);

  const manifestFile = zip.file("manifest.json");
  if (!manifestFile) throw new Error("manifest.json was not found in the extension package.");

  const manifestText = await manifestFile.async("text");
  const manifest = JSON.parse(manifestText) as ExtensionManifest;

  const permissions = normalizeManifestStrings(manifest.permissions);
  const optionalPermissions = normalizeManifestStrings(manifest.optional_permissions);
  const hostPermissions = normalizeManifestStrings(manifest.host_permissions);
  const optionalHostPermissions = normalizeManifestStrings(manifest.optional_host_permissions);
  const contentScriptMatches = (manifest.content_scripts ?? []).flatMap((script) =>
    normalizeManifestStrings(script.matches),
  );

  const staticCounts = new Map<string, number>();
  const externalHosts = new Set<string>();
  let jsFilesScanned = 0;
  let scannedChars = 0;

  for (const entry of files) {
    if (!entry.name.endsWith(".js")) continue;
    if (scannedChars >= MAX_TOTAL_SCANNED_CHARS) break;

    const text = await entry.async("text");
    const sample = text.slice(0, MAX_JS_FILE_CHARS);
    scannedChars += sample.length;
    jsFilesScanned += 1;

    for (const rule of STATIC_RULES) {
      const count = countMatches(sample, rule.pattern);
      if (count > 0) staticCounts.set(rule.label, (staticCounts.get(rule.label) ?? 0) + count);
    }

    for (const host of extractExternalHosts(sample)) externalHosts.add(host);
  }

  return {
    id,
    name: manifest.name ?? "Unnamed extension",
    version: manifest.version ?? "unknown",
    manifestVersion: manifest.manifest_version ?? null,
    permissions: [...new Set(permissions)].sort(),
    optionalPermissions: [...new Set(optionalPermissions)].sort(),
    hostPermissions: [...new Set(hostPermissions)].sort(),
    optionalHostPermissions: [...new Set(optionalHostPermissions)].sort(),
    contentScriptMatches: [...new Set(contentScriptMatches)].sort(),
    capabilities: buildCapabilities(permissions, hostPermissions, contentScriptMatches),
    staticSignals: [...staticCounts.entries()]
      .map(([label, matches]) => ({ label, matches }))
      .sort((a, b) => b.matches - a.matches),
    externalHosts: [...externalHosts].sort().slice(0, 100),
    package: {
      compressedBytes: crxBytes.byteLength,
      fileCount: files.length,
      jsFilesScanned,
    },
    disclaimer:
      "Xtension reports declared capabilities and static code references. Optional permissions are shown separately because they may not be granted. Findings do not prove that an extension collects data, abuses a permission, or behaves maliciously.",
  };
}
