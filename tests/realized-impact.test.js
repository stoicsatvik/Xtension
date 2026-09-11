import { describe, expect, it } from "vitest";
import { realizedImpact, realizedImpactNarrative } from "../agent/realized-impact.js";

describe("realized local impact", () => {
  it("counts observed outcomes without attributing causality", () => {
    const impact = realizedImpact({
      removedExtensions: [
        { permissions: ["history"], hostPermissions: ["<all_urls>"] },
        { permissions: [], hostPermissions: [] }
      ],
      trials: {
        a: { outcome: "needed", startedAt: 0, endedAt: 0 },
        b: { outcome: "survived-trial", startedAt: 1, endedAt: 25 * 24 * 60 * 60 * 1000 }
      },
      extensions: [
        { enabled: false, permissions: ["debugger"], hostPermissions: ["<all_urls>"] },
        { enabled: true, permissions: [], hostPermissions: [] }
      ]
    });

    expect(impact.observedRemovals).toBe(2);
    expect(impact.removedBroadHostAccess).toBe(1);
    expect(impact.removedSensitivePermissionGrants).toBe(1);
    expect(impact.restoredDuringTrial).toBe(1);
    expect(impact.survivedTrials).toBe(1);
    expect(impact.longSurvivedTrials).toBe(1);
    expect(impact.currentlyDisabledHighExposure).toBe(1);
    expect(realizedImpactNarrative(impact)).toContain("not claims that Xtension caused");
  });

  it("stays quiet before actual outcome evidence exists", () => {
    const impact = realizedImpact();
    expect(realizedImpactNarrative(impact)).toContain("No cleanup outcomes");
  });
});
