import { describe, expect, it } from "vitest";
import { installReview } from "../agent/install-review-policy.js";

describe("new-install review policy", () => {
  it("interrupts for broad website access without calling the extension malicious", () => {
    const review = installReview({
      id: "broad",
      name: "Broad Tool",
      type: "extension",
      permissions: [],
      hostPermissions: ["<all_urls>"]
    });
    expect(review?.severity).toBe("high");
    expect(review?.kind).toBe("install-review");
    expect(review?.detail).toContain("not a malware verdict");
  });

  it("interrupts for multiple mapped sensitive API permissions", () => {
    const review = installReview({
      id: "sensitive",
      name: "Power Tool",
      type: "extension",
      permissions: ["history", "cookies"],
      hostPermissions: []
    });
    expect(review?.severity).toBe("high");
    expect(review?.data.permissions).toEqual(["cookies", "history"]);
  });

  it("does not manufacture an alert for ordinary low exposure", () => {
    expect(installReview({
      id: "low",
      name: "Simple Tool",
      type: "extension",
      permissions: ["storage"],
      hostPermissions: []
    })).toBeNull();
  });

  it("ignores non-extension management items", () => {
    expect(installReview({ name: "Theme", type: "theme", permissions: [], hostPermissions: [] })).toBeNull();
  });
});
