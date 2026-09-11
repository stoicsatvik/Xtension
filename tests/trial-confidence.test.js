import { describe, expect, it } from "vitest";
import { decisionConfidence } from "../agent/decision-intelligence.js";
import { trialDurationDays, trialEvidenceStrength } from "../agent/trial-policy.js";

const DAY = 24 * 60 * 60 * 1000;
const extension = {
  id: "fixture",
  name: "Fixture",
  enabled: false,
  permissions: [],
  hostPermissions: [],
  observedStateSince: Date.now()
};

function completedTrial(days) {
  return {
    active: false,
    outcome: "survived-trial",
    startedAt: 1_000,
    plannedEndAt: 1_000 + days * DAY,
    endedAt: 1_000 + days * DAY
  };
}

describe("disable-trial evidence calibration", () => {
  it("does not pretend a short trial rules out infrequent workflows", () => {
    const trial = completedTrial(3);
    expect(trialDurationDays(trial)).toBe(3);
    expect(trialEvidenceStrength(trial)).toBe("low");
    expect(decisionConfidence(extension, { trial }).level).toBe("low");
  });

  it("treats a seven-day trial as useful but not conclusive", () => {
    const trial = completedTrial(7);
    expect(trialEvidenceStrength(trial)).toBe("medium");
    const confidence = decisionConfidence(extension, { trial });
    expect(confidence.level).toBe("medium");
    expect(confidence.reasons.join(" ")).toContain("monthly");
  });

  it("treats a longer trial as high-confidence cleanup evidence", () => {
    const trial = completedTrial(30);
    expect(trialEvidenceStrength(trial)).toBe("high");
    expect(decisionConfidence(extension, { trial }).level).toBe("high");
  });

  it("keeps restore-during-trial as high-confidence dependency evidence regardless of duration", () => {
    const trial = {
      ...completedTrial(1),
      outcome: "needed"
    };
    expect(trialEvidenceStrength(trial)).toBe("high");
    expect(decisionConfidence({ ...extension, enabled: true }, { trial }).level).toBe("high");
  });
});
