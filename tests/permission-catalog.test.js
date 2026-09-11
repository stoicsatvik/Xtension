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

  it("reports wildcard domains and file access conservatively", () => {
    const result = summarizeHostAccess(["https://*.example.com/*", "file:///*"]);
    expect(result.level).toBe("multi-site");
    expect(result.wildcardDomains).toHaveLength(1);
    expect(result.fileAccessDeclared).toBe(true);
  });
});
