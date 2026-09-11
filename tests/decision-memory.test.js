import { describe, expect, it } from "vitest";
import { decisionBasis, decisionMemoryState, shouldIncludeInAudit } from "../agent/decision-memory.js";

const extension = {
  id: "x",
  permissions: ["tabs"],
  hostPermissions: ["https://github.com/*"],
  installType: "normal",
  mayDisable: true
};

const evidence = { trial: { outcome: "needed" } };

describe("decision memory", () => {
  it("keeps a verdict fresh while material evidence is unchanged", () => {
    const preference = {
      verdict: "essential",
      decisionBasis: decisionBasis(extension, evidence),
      updatedAt: 100
    };

    const state = decisionMemoryState(extension, preference, evidence, 200);
    expect(state.state).toBe("fresh");
    expect(state.fresh).toBe(true);
    expect(shouldIncludeInAudit(extension, preference, evidence, 200)).toBe(false);
  });

  it("reopens review when access changes", () => {
    const preference = {
      verdict: "essential",
      decisionBasis: decisionBasis(extension, evidence)
    };
    const changed = { ...extension, permissions: ["tabs", "history"] };

    expect(decisionMemoryState(changed, preference, evidence).state).toBe("stale");
    expect(shouldIncludeInAudit(changed, preference, evidence)).toBe(true);
  });

  it("reopens review on a scheduled review date", () => {
    const preference = {
      verdict: "optional",
      decisionBasis: decisionBasis(extension, evidence),
      reviewAt: 500
    };

    expect(decisionMemoryState(extension, preference, evidence, 500).state).toBe("due");
  });
});
