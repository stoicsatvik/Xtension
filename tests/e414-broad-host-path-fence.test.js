import { describe, expect, it } from "vitest";
import {
  deriveWorkflowSignals,
  exposureAssessment,
  hasBroadHostAccess,
  hostPatternMatchesUrl
} from "../agent/core.js";

// E414: Chromium treats the path of manifest host_permissions as /*.
// These are synthetic declared-permission fixtures, NOT actual browser grants.
const extension = (pattern) => ({
  id: "synthetic",
  enabled: true,
  permissions: [],
  hostPermissions: [pattern]
});

describe("E414: wildcard-host permission path is not an exposure limiter", () => {
  it.each([
    "https://*/foo*",
    "http://*/private/page",
    "*://*/internal/*",
    "https://*/"
  ])("recognizes a wildcard host even when the declared path is %s", (pattern) => {
    expect(hasBroadHostAccess(extension(pattern))).toBe(true);
    const assessment = exposureAssessment(extension(pattern));
    expect(assessment.broadHostAccess).toBe(true);
    expect(assessment.level).toBe("high");
    expect(assessment.reasons).toContain("broad website access");
  });

  it("keeps path-only substrings and scoped subdomains out of broad classification", () => {
    for (const pattern of [
      "https://*.example.org/foo*",
      "https://example.org/x/*://*/*",
      "https://*foo.org/foo",
      "ftp://*/foo*"
    ]) {
      expect(hasBroadHostAccess(extension(pattern))).toBe(false);
    }
  });

  it("preserves the preexisting canonical wildcard-host and all-urls behavior", () => {
    expect(hasBroadHostAccess(extension("https://*/*"))).toBe(true);
    expect(hasBroadHostAccess(extension("<all_urls>"))).toBe(true);
  });

  it("does not mistake path strings for host-scoping when counting local opportunity", () => {
    const candidate = extension("https://*/private/page");
    const pages = ["https://alpha.example/public", "https://beta.example/other", "http://gamma.example/"];
    const signal = deriveWorkflowSignals([candidate], pages).synthetic;
    expect(signal).toEqual({
      kind: "broad",
      totalRecentPages: 3,
      matchedPages: 2,
      matchedHosts: 2
    });
    expect(hostPatternMatchesUrl(candidate.hostPermissions[0], new URL(pages[0]))).toBe(true);
  });
});
