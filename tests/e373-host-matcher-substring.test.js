import { describe, expect, it } from "vitest";
import { deriveWorkflowSignals, hasBroadHostAccess, hostPatternMatchesUrl } from "../agent/core.js";
import { summarizeHostAccess } from "../agent/permission-catalog.js";

// E373: a substring resembling an all-sites Chrome pattern must not be
// interpreted as a real permission. The catalog already uses full matches;
// workflow overlap must agree or it fabricates page-access evidence.
const invalidPatterns = [
  "https://example.org/path/*://*/*",
  "prefix*://*/*",
  "https://example.org/*://*/*"
];

describe("E373: reject embedded all-sites substrings", () => {
  it("rejects malformed embedded patterns in the workflow matcher", () => {
    for (const pattern of invalidPatterns) {
      expect(hasBroadHostAccess({ hostPermissions: [pattern] })).toBe(false);
      expect(summarizeHostAccess([pattern]).broadPatterns).toEqual([]);
      expect(hostPatternMatchesUrl(pattern, new URL("https://unrelated.example/"))).toBe(false);
      expect(hostPatternMatchesUrl(pattern, new URL("http://unrelated.example/"))).toBe(false);
    }
  });

  it("does not invent recent page overlap from a malformed pattern", () => {
    const pages = ["https://unrelated.example/a", "http://different.example/b"];
    const result = deriveWorkflowSignals([
      { id: "malformed", hostPermissions: invalidPatterns, permissions: [], enabled: true }
    ], pages);
    expect(result.malformed.matchedPages).toBe(0);
    expect(result.malformed.matchedHosts).toBe(0);
  });

  it("preserves legitimate broad and scheme-limited matches", () => {
    const https = new URL("https://unrelated.example/a");
    const http = new URL("http://unrelated.example/a");
    expect(hostPatternMatchesUrl("*://*/*", https)).toBe(true);
    expect(hostPatternMatchesUrl("*://*/*", http)).toBe(true);
    expect(hostPatternMatchesUrl("https://*/*", https)).toBe(true);
    expect(hostPatternMatchesUrl("https://*/*", http)).toBe(false);
    expect(hostPatternMatchesUrl("<all_urls>", https)).toBe(true);
    expect(hostPatternMatchesUrl("https://*.example.org/*", new URL("https://sub.example.org/a"))).toBe(true);
    expect(hostPatternMatchesUrl("https://*.example.org/*", new URL("https://notexample.org/a"))).toBe(false);
  });
});
