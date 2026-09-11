import { describe, expect, it } from "vitest";
import { applyTrialOutcome, reconcileTrialObservation } from "../agent/trial-policy.js";

const activeTrial = (overrides = {}) => ({
  active: true,
  status: "active",
  startedAt: 100,
  plannedEndAt: 1000,
  outcome: null,
  ...overrides
});

describe("trial reconciliation", () => {
  it("treats an external re-enable as strong dependency evidence", () => {
    const transition = reconcileTrialObservation(activeTrial(), { exists: true, enabled: true }, 500);
    expect(transition.outcome).toBe("needed");
    expect(applyTrialOutcome(activeTrial(), transition)).toMatchObject({
      active: false,
      status: "ended",
      outcome: "needed",
      endedAt: 500
    });
  });

  it("records an uninstall during a trial", () => {
    const transition = reconcileTrialObservation(activeTrial(), { exists: false }, 600);
    expect(transition.outcome).toBe("uninstalled");
  });

  it("completes a trial only after its planned end while still disabled", () => {
    expect(reconcileTrialObservation(activeTrial(), { exists: true, enabled: false }, 900)).toBeNull();
    expect(reconcileTrialObservation(activeTrial(), { exists: true, enabled: false }, 1000).outcome).toBe("survived-trial");
  });

  it("does nothing for an already-ended trial", () => {
    expect(reconcileTrialObservation({ active: false, outcome: "needed" }, { exists: false }, 2000)).toBeNull();
  });
});
