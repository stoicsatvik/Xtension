import { describe, expect, it } from "vitest";
import { decisionConfidence, portfolioSummary } from "../agent/decision-intelligence.js";

const extension = (overrides = {}) => ({
  id: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  name: "Fixture",
  enabled: true,
  permissions: [],
  hostPermissions: [],
  ...overrides
});

describe("decision confidence", () => {
  it("treats explicit verdicts and restore-during-trial as high-confidence evidence", () => {
    expect(decisionConfidence(extension(), { verdict: "essential" }).level).toBe("high");
    expect(decisionConfidence(extension(), { trial: { outcome: "needed" } }).level).toBe("high");
  });

  it("does not overstate an unknown-duration completed trial", () => {
    const result = decisionConfidence(extension({ enabled: false }), { trial: { outcome: "survived-trial" } });
    expect(result.level).toBe("low");
    expect(result.reasons.join(" ")).toContain("too short or unknown");
  });

  it("treats long-disabled and site-overlap evidence as medium confidence", () => {
    const item = extension({ enabled: false, observedStateSince: Date.now() - 40 * 24 * 60 * 60 * 1000 });
    expect(decisionConfidence(item).level).toBe("medium");
    expect(decisionConfidence(extension(), { workflow: { kind: "no-overlap" } }).level).toBe("medium");
  });

  it("does not convert exposure alone into certainty about usefulness", () => {
    const result = decisionConfidence(extension({ hostPermissions: ["<all_urls>"] }));
    expect(result.level).toBe("low");
    expect(result.reasons.join(" ")).toContain("does not establish usefulness");
  });
});

describe("portfolio summary", () => {
  it("counts actionable local evidence without inventing a global risk score", () => {
    const now = Date.now();
    const items = [
      extension({ id: "one", hostPermissions: ["<all_urls>"] }),
      extension({ id: "two", enabled: false, observedStateSince: now - 45 * 24 * 60 * 60 * 1000 }),
      extension({ id: "three" })
    ];
    const summary = portfolioSummary(items, {
      one: { verdict: "essential" },
      two: { verdict: "unnecessary", stateAgeDays: 45 },
      three: { trial: { active: true } }
    });

    expect(summary.installed).toBe(3);
    expect(summary.highExposureEnabled).toBe(1);
    expect(summary.longDisabled).toBe(1);
    expect(summary.markedUnnecessary).toBe(1);
    expect(summary.activeTrials).toBe(1);
    expect(summary.highConfidenceReviews).toBeGreaterThanOrEqual(1);
  });
});
