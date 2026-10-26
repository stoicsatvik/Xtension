import { describe, expect, it } from "vitest";
import { LOCAL_EVIDENCE_KEYS, buildLocalEvidenceExport } from "../agent/export-policy.js";

const privateUrl = "https://private.example/account?secret=not-for-export";

describe("E304: ambiguous nested browsing URL aliases", () => {
  it("rejects a pageUrl nested inside otherwise approved audit evidence", () => {
    const stored = {
      [LOCAL_EVIDENCE_KEYS.auditSession]: {
        action: { pageUrl: privateUrl, visitedAt: 123456, reason: "review" }
      }
    };
    expect(() => buildLocalEvidenceExport(stored)).toThrow(/history|visit|url|page/i);
  });

  it("rejects an href plus visitTime nested in a timeline", () => {
    const stored = {
      [LOCAL_EVIDENCE_KEYS.timeline]: [
        { metadata: { href: privateUrl, visitTime: 123456 } }
      ]
    };
    expect(() => buildLocalEvidenceExport(stored)).toThrow(/history|visit|url|page/i);
  });

  it("rejects an ambiguous generic URL field without Chrome history counters", () => {
    const stored = {
      [LOCAL_EVIDENCE_KEYS.alerts]: [
        { source: { url: privateUrl, label: "possible context" } }
      ]
    };
    expect(() => buildLocalEvidenceExport(stored)).toThrow(/history|visit|url|page/i);
  });

  it("retains declared extension metadata URLs and host permissions", () => {
    const stored = {
      [LOCAL_EVIDENCE_KEYS.inventory]: {
        extensions: [{
          id: "a".repeat(32),
          homepageUrl: "https://publisher.example/",
          optionsUrl: "chrome-extension://extension/options.html",
          hostPermissions: ["https://example.org/*"]
        }]
      }
    };
    const exported = buildLocalEvidenceExport(stored);
    expect(exported.inventory.extensions[0].homepageUrl).toBe("https://publisher.example/");
    expect(exported.inventory.extensions[0].hostPermissions).toEqual(["https://example.org/*"]);
  });

  it("detaches exported evidence from subsequent source-object mutations", () => {
    const original = { extensions: [{ id: "a".repeat(32), enabled: true }] };
    const stored = { [LOCAL_EVIDENCE_KEYS.inventory]: original };
    const exported = buildLocalEvidenceExport(stored);
    original.extensions[0].pageUrl = privateUrl;
    original.extensions[0].enabled = false;
    expect(exported.inventory.extensions[0].enabled).toBe(true);
    expect(JSON.stringify(exported)).not.toContain("private.example");
  });
});
