import { describe, expect, it } from "vitest";
import { describePermission, describePermissions, summarizeHostAccess } from "../agent/permission-catalog.js";

describe("permission catalog", () => {
  it("explains known permissions without turning capability into an accusation", () => {
    const scripting = describePermission("scripting");
    expect(scripting.known).toBe(true);
    expect(scripting.sensitivity).toBe("high");
    expect(scripting.detail).toContain("required host access");
  });

  it("keeps unknown permissions visible instead of inventing semantics", () => {
    const unknown = describePermission("futurePermission");
    expect(unknown.known).toBe(false);
    expect(unknown.sensitivity).toBe("unknown");
    expect(unknown.detail).toContain("not mapped");
  });

  it("orders higher-sensitivity permissions first", () => {
    const descriptions = describePermissions(["storage", "history", "contextMenus"]);
    expect(descriptions[0].permission).toBe("history");
  });
});

describe("host access summary", () => {
  it("distinguishes broad access from scoped access", () => {
    expect(summarizeHostAccess(["<all_urls>"]).level).toBe("broad");
    expect(summarizeHostAccess(["https://github.com/*"]).level).toBe("scoped");
    expect(summarizeHostAccess([]).level).toBe("none");
  });

  it("E352: treats scheme-wide wildcard hosts as broad consistently with core", () => {
    for (const pattern of ["https://*/*", "http://*/*", "*://*/*", "<all_urls>"]) {
      const summary = summarizeHostAccess([pattern]);
      expect(summary.level).toBe("broad");
      expect(summary.broadPatterns).toEqual([pattern]);
      expect(summary.patternCount).toBe(1);
    }
  });

  it("E352: keeps wildcard subdomains scoped and rejects substring false positives", () => {
    for (const pattern of ["https://*.example.org/*", "http://*.example.org/*"]) {
      const summary = summarizeHostAccess([pattern]);
      expect(summary.level).toBe("multi-site");
      expect(summary.broadPatterns).toEqual([]);
    }
    const malformed = summarizeHostAccess(["https://example.org/path/*://*/*"]);
    expect(malformed.broadPatterns).toEqual([]);
    expect(malformed.level).toBe("scoped");
  });

  it("E352: broad patterns dominate mixed scoped and file access", () => {
    const summary = summarizeHostAccess(["file:///*", "https://*.example.org/*", "https://*/*"]);
    expect(summary.level).toBe("broad");
    expect(summary.broadPatterns).toEqual(["https://*/*"]);
    expect(summary.wildcardDomains).toEqual(["https://*.example.org/*"]);
    expect(summary.fileAccessDeclared).toBe(true);
  });

  it("reports wildcard domains and file access conservatively", () => {
    const result = summarizeHostAccess(["https://*.example.com/*", "file:///*"]);
    expect(result.level).toBe("multi-site");
    expect(result.wildcardDomains).toHaveLength(1);
    expect(result.fileAccessDeclared).toBe(true);
  });
});
