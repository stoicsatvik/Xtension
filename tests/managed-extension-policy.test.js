import { describe, expect, it } from "vitest";
import {
  attentionPriority,
  buildRecommendation,
  managementAssessment
} from "../agent/core.js";

const extension = (overrides = {}) => ({
  id: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  name: "Managed Fixture",
  enabled: true,
  installType: "normal",
  mayDisable: true,
  permissions: [],
  hostPermissions: [],
  ...overrides
});

describe("managed extension policy", () => {
  it("recognizes administrator-installed extensions", () => {
    const assessment = managementAssessment(extension({ installType: "admin" }));
    expect(assessment.managed).toBe(true);
    expect(assessment.policyInstalled).toBe(true);
  });

  it("does not recommend impossible disable trials for managed extensions", () => {
    const item = extension({
      installType: "admin",
      mayDisable: false,
      hostPermissions: ["<all_urls>"]
    });
    const recommendation = buildRecommendation(item, { workflow: { kind: "no-overlap" } });
    expect(recommendation.label).toContain("Managed by policy");
    expect(recommendation.label).not.toContain("Trial-disable");
  });

  it("routes an unwanted managed extension to policy review", () => {
    const item = extension({ installType: "admin", mayDisable: false });
    const recommendation = buildRecommendation(item, { verdict: "unnecessary" });
    expect(recommendation.kind).toBe("review");
    expect(recommendation.label).toContain("review with admin");
    expect(attentionPriority(item, { verdict: "unnecessary" })).toBe(72);
  });

  it("preserves an explicit essential verdict without framing management as failure", () => {
    const item = extension({ installType: "admin", mayDisable: false });
    const recommendation = buildRecommendation(item, { verdict: "essential" });
    expect(recommendation.kind).toBe("keep");
    expect(recommendation.label).toContain("Managed + marked essential");
  });
});
