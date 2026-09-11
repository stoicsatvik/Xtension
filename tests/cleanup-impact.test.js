import { describe, expect, it } from "vitest";
import { cleanupImpact, cleanupImpactNarrative } from "../agent/cleanup-impact.js";

const ext = (id, overrides = {}) => ({
  id,
  name: id,
  enabled: true,
  permissions: [],
  hostPermissions: [],
  ...overrides
});

describe("cleanup impact", () => {
  it("counts exposure that could be reduced by evidence-backed review candidates", () => {
    const extensions = [
      ext("essential", { hostPermissions: ["<all_urls>"] }),
      ext("candidate", { permissions: ["history", "cookies"] }),
      ext("quiet", { enabled: false, permissions: ["history"] })
    ];
    const impact = cleanupImpact(extensions, {
      essential: { verdict: "essential" },
      candidate: { verdict: "unnecessary" }
    });

    expect(impact.enabledExtensions).toBe(2);
    expect(impact.enabledHighExposure).toBe(2);
    expect(impact.reviewCandidates).toBe(1);
    expect(impact.highConfidenceCleanupCandidates).toBe(1);
    expect(impact.candidateHighExposure).toBe(1);
    expect(impact.candidateSensitivePermissionGrants).toBe(2);
  });

  it("describes potential reductions rather than promising safety", () => {
    const text = cleanupImpactNarrative({
      reviewCandidates: 2,
      candidateHighExposure: 1,
      candidateBroadHostAccess: 1,
      candidateSensitivePermissionGrants: 3
    });
    expect(text).toContain("potential reductions only");
    expect(text).toContain("never removes them automatically");
  });
});
