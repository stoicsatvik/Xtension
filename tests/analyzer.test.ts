import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { analyzePackage, extractExtensionId, stripCrxHeader } from "@/lib/analyzer";

describe("extension id parsing", () => {
  const id = "abcdefghijklmnopabcdefghijklmnop";

  it("accepts a raw extension id", () => {
    expect(extractExtensionId(id)).toBe(id);
  });

  it("extracts ids from Chrome Web Store URLs", () => {
    expect(extractExtensionId(`https://chromewebstore.google.com/detail/example/${id}`)).toBe(id);
  });

  it("rejects unrelated hosts", () => {
    expect(extractExtensionId(`https://example.com/${id}`)).toBeNull();
  });
});

describe("package analysis", () => {
  it("analyzes a ZIP fixture without executing code", async () => {
    const zip = new JSZip();
    zip.file(
      "manifest.json",
      JSON.stringify({
        name: "Fixture Extension",
        version: "1.2.3",
        manifest_version: 3,
        permissions: ["tabs", "scripting"],
        host_permissions: ["<all_urls>"],
      }),
    );
    zip.file(
      "background.js",
      "chrome.tabs.query({}); fetch('https://api.example.com/test');",
    );

    const bytes = await zip.generateAsync({ type: "uint8array" });
    expect(stripCrxHeader(bytes)).toEqual(bytes);

    const report = await analyzePackage("abcdefghijklmnopabcdefghijklmnop", bytes);
    expect(report.name).toBe("Fixture Extension");
    expect(report.permissions).toContain("tabs");
    expect(report.hostPermissions).toContain("<all_urls>");
    expect(report.capabilities.some((item) => item.source === "host:<all_urls>")).toBe(true);
    expect(report.staticSignals.some((item) => item.label === "Tabs API reference")).toBe(true);
    expect(report.externalHosts).toContain("api.example.com");
  });
});
