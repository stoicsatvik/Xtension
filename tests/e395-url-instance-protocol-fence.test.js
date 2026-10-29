import { describe, expect, it } from "vitest";
import { deriveWorkflowSignals } from "../agent/core.js";

// E395: URL instances must not bypass the same HTTP(S) gate used for strings.
// These are synthetic local fixtures, not imported browser history.
const extension = {
  id: "broad",
  enabled: true,
  hostPermissions: ["<all_urls>"],
  permissions: []
};

describe("E395: URL-instance protocol normalization", () => {
  it("excludes non-web URL objects before counting history or overlap", () => {
    const history = [
      new URL("https://alpha.example/a"),
      new URL("http://beta.example/b"),
      new URL("file:///tmp/private-notes.txt"),
      new URL("chrome://extensions/"),
      new URL("ftp://archive.example/old"),
      new URL("data:text/plain,synthetic")
    ];
    const signal = deriveWorkflowSignals([extension], history).broad;
    expect(signal).toEqual({
      kind: "broad",
      totalRecentPages: 2,
      matchedPages: 2,
      matchedHosts: 2
    });
  });

  it("treats equivalent URL objects and strings identically", () => {
    const strings = ["https://alpha.example/a", "http://beta.example/b", "file:///tmp/private.txt"];
    const objects = strings.map((value) => new URL(value));
    expect(deriveWorkflowSignals([extension], objects))
      .toEqual(deriveWorkflowSignals([extension], strings));
  });

  it("does not fabricate a broad-host visit when every URL object is non-web", () => {
    const signal = deriveWorkflowSignals([extension], [
      new URL("file:///tmp/private.txt"),
      new URL("chrome://extensions/")
    ]).broad;
    expect(signal.totalRecentPages).toBe(0);
    expect(signal.matchedPages).toBe(0);
    expect(signal.matchedHosts).toBe(0);
  });
});
