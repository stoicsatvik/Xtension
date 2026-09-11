import { describe, expect, it } from "vitest";
import { applyTrialAnnotation, normalizeDependencyReason } from "../agent/trial-policy.js";

describe("trial dependency context", () => {
  it("normalizes and bounds user-authored restore reasons", () => {
    expect(normalizeDependencyReason("  Needed   the GitHub PR sidebar  ")).toBe("Needed the GitHub PR sidebar");
    expect(normalizeDependencyReason(" ")).toBeNull();
    expect(normalizeDependencyReason("x".repeat(500))).toHaveLength(300);
  });

  it("persists context only for trials that ended because the extension was needed", () => {
    const trial = { outcome: "needed", extensionName: "Fixture" };
    const annotated = applyTrialAnnotation(trial, "Needed checkout autofill", 1234);
    expect(annotated.dependencyReason).toBe("Needed checkout autofill");
    expect(annotated.dependencyReasonAt).toBe(1234);

    expect(() => applyTrialAnnotation({ outcome: "survived-trial" }, "reason")).toThrow(/only annotate trials/i);
  });

  it("allows the user to clear previously recorded context", () => {
    const trial = {
      outcome: "needed",
      dependencyReason: "Old reason",
      dependencyReasonAt: 10
    };
    const cleared = applyTrialAnnotation(trial, "");
    expect(cleared.dependencyReason).toBeNull();
    expect(cleared.dependencyReasonAt).toBeNull();
  });
});
