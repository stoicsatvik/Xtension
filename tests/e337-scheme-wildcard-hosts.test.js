import { describe, expect, it } from "vitest";
import {
  attentionPriority,
  buildRecommendation,
  deriveWorkflowSignals,
  exposureAssessment,
  hasBroadHostAccess,
  hostPatternMatchesUrl
} from "../agent/core.js";

const fixture = (id, hostPermissions) => ({
  id, name: id, enabled: true, permissions: [], hostPermissions
});

describe("E337: scheme-wide Chrome host access", () => {
  it("classifies wildcard hosts as broad even when limited to one web scheme", () => {
    for (const pattern of ["http://*/*", "https://*/*", "*://*/*", "<all_urls>"]) {
      const extension = fixture(pattern, [pattern]);
      expect(hasBroadHostAccess(extension)).toBe(true);
      expect(exposureAssessment(extension).level).toBe("high");
      expect(exposureAssessment(extension).broadHostAccess).toBe(true);
      expect(buildRecommendation(extension).kind).toBe("review");
      expect(attentionPriority(extension)).toBe(76);
    }
  });

  it("does not promote a wildcard subdomain or single origin to global access", () => {
    for (const pattern of ["https://*.example.org/*", "http://example.org/*", "*://example.org/*"]) {
      expect(hasBroadHostAccess(fixture(pattern, [pattern]))).toBe(false);
    }
  });

  it("preserves the scheme restriction in individual host matching", () => {
    expect(hostPatternMatchesUrl("https://*/*", new URL("https://example.org/a"))).toBe(true);
    expect(hostPatternMatchesUrl("https://*/*", new URL("http://example.org/a"))).toBe(false);
    expect(hostPatternMatchesUrl("http://*/*", new URL("http://example.org/a"))).toBe(true);
    expect(hostPatternMatchesUrl("http://*/*", new URL("https://example.org/a"))).toBe(false);
  });

  it("does not count unpermitted schemes as observed workflow overlap", () => {
    const extensions = [
      fixture("https-only", ["https://*/*"]),
      fixture("http-only", ["http://*/*"]),
      fixture("both", ["*://*/*"]),
      fixture("split", ["https://*/*", "http://*/*"])
    ];
    const pages = [
      "https://alpha.example/page",
      "http://beta.example/page",
      "https://gamma.example/page"
    ];
    const result = deriveWorkflowSignals(extensions, pages);
    expect(result["https-only"]).toEqual({
      kind: "broad", totalRecentPages: 3, matchedPages: 2, matchedHosts: 2
    });
    expect(result["http-only"]).toEqual({
      kind: "broad", totalRecentPages: 3, matchedPages: 1, matchedHosts: 1
    });
    for (const id of ["both", "split"]) {
      expect(result[id]).toEqual({
        kind: "broad", totalRecentPages: 3, matchedPages: 3, matchedHosts: 3
      });
    }
  });

  it("does not count the same page twice when broad patterns overlap", () => {
    const result = deriveWorkflowSignals(
      [fixture("overlap", ["https://*/*", "*://*/*"])],
      ["https://alpha.example/one", "https://alpha.example/two"]
    );
    expect(result.overlap.matchedPages).toBe(2);
    expect(result.overlap.matchedHosts).toBe(1);
  });
});
