import { describe, expect, it } from "vitest";
import {
  attentionPriority,
  buildRecommendation,
  deriveWorkflowSignals,
  exposureAssessment,
  findPotentialRedundancies,
  hostPatternMatchesUrl,
  inferCategory,
  observedStateAgeDays
} from "../agent/core.js";
import { decisionConfidence, portfolioSummary } from "../agent/decision-intelligence.js";
import { cleanupImpact } from "../agent/cleanup-impact.js";
import { applyTrialOutcome, reconcileTrialObservation } from "../agent/trial-policy.js";

const extension = (overrides = {}) => ({
  id: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  name: "Fixture",
  shortName: "Fixture",
  description: "Fixture extension",
  enabled: true,
  permissions: [],
  hostPermissions: [],
  observedStateSince: Date.now(),
  mayDisable: true,
  ...overrides
});

describe("exposure assessment", () => {
  it("treats broad website access as high exposure", () => {
    const result = exposureAssessment(extension({ hostPermissions: ["<all_urls>"] }));
    expect(result.level).toBe("high");
    expect(result.broadHostAccess).toBe(true);
    expect(result.reasons).toContain("broad website access");
  });

  it("explains sensitive API exposure", () => {
    const result = exposureAssessment(extension({ permissions: ["history", "cookies"] }));
    expect(result.level).toBe("high");
    expect(result.sensitivePermissions).toEqual(["history", "cookies"]);
  });
});

describe("host matching and workflow evidence", () => {
  it("matches wildcard subdomains and apex but not unrelated domains", () => {
    expect(hostPatternMatchesUrl("https://*.github.com/*", new URL("https://gist.github.com/x"))).toBe(true);
    expect(hostPatternMatchesUrl("https://*.github.com/*", new URL("https://github.com/openai"))).toBe(true);
    expect(hostPatternMatchesUrl("https://*.github.com/*", new URL("https://notgithub.com"))).toBe(false);
  });

  it("keeps schemes distinct when host access is scheme-specific", () => {
    expect(hostPatternMatchesUrl("http://example.com/*", new URL("https://example.com"))).toBe(false);
    expect(hostPatternMatchesUrl("*://example.com/*", new URL("https://example.com"))).toBe(true);
  });

  it("keeps broad access separate from actual usage evidence", () => {
    const extensions = [
      extension({ id: "broad", hostPermissions: ["<all_urls>"] }),
      extension({ id: "github", hostPermissions: ["https://github.com/*"] }),
      extension({ id: "unused", hostPermissions: ["https://example.net/*"] })
    ];
    const signals = deriveWorkflowSignals(extensions, ["https://github.com/openai", "https://news.ycombinator.com"]);

    expect(signals.broad.kind).toBe("broad");
    expect(signals.github.kind).toBe("overlap");
    expect(signals.github.matchedPages).toBe(1);
    expect(signals.unused.kind).toBe("no-overlap");
  });
});

describe("recommendations", () => {
  it("prioritizes a completed disable trial over weak contextual evidence", () => {
    const item = extension({ hostPermissions: ["https://github.com/*"] });
    const recommendation = buildRecommendation(item, {
      trial: { active: false, outcome: "survived-trial" },
      workflow: { kind: "overlap", matchedHosts: 1 }
    });

    expect(recommendation.kind).toBe("review");
    expect(recommendation.label).toContain("consider removal");
    expect(attentionPriority(item, { trial: { outcome: "survived-trial" } })).toBe(100);
  });

  it("treats restore-during-trial as strong keep evidence", () => {
    const item = extension();
    const evidence = { trial: { active: false, outcome: "needed" } };
    expect(buildRecommendation(item, evidence).kind).toBe("keep");
    expect(decisionConfidence(item, evidence).level).toBe("high");
  });

  it("respects explicit essential verdicts while still flagging broad access", () => {
    const item = extension({ hostPermissions: ["<all_urls>"] });
    const recommendation = buildRecommendation(item, { verdict: "essential", workflow: { kind: "no-overlap" } });
    expect(recommendation.kind).toBe("keep");
    expect(recommendation.label).toContain("monitor access");
  });

  it("uses continuous observed disabled duration without pretending to know pre-install history", () => {
    const now = Date.UTC(2026, 8, 11);
    const item = extension({
      enabled: false,
      observedStateSince: now - 45 * 24 * 60 * 60 * 1000
    });
    expect(Math.floor(observedStateAgeDays(item, now))).toBe(45);

    const recommendation = buildRecommendation(item, { stateAgeDays: 45 });
    expect(recommendation.label).toContain("Long-disabled");
    expect(attentionPriority(item, { stateAgeDays: 45 })).toBe(90);
  });
});

describe("conservative redundancy evidence", () => {
  it("detects same-category enabled tools as a review hint", () => {
    const items = [
      extension({ id: "one", name: "Dark Reader" }),
      extension({ id: "two", name: "Night Mode Pro" }),
      extension({ id: "disabled", name: "Dark Mode Old", enabled: false })
    ];
    const evidence = findPotentialRedundancies(items);
    expect(inferCategory(items[0])).toBe("dark-mode");
    expect(evidence.one.category).toBe("dark-mode");
    expect(evidence.one.confidence).toBe("low");
    expect(evidence.one.peers.map((peer) => peer.id)).toEqual(["two"]);
    expect(evidence.disabled).toBeUndefined();
  });

  it("does not call unrelated extensions redundant", () => {
    const items = [
      extension({ id: "one", name: "Dark Reader" }),
      extension({ id: "two", name: "Password Manager" })
    ];
    expect(findPotentialRedundancies(items)).toEqual({});
  });
});

describe("trial policy", () => {
  const active = {
    active: true,
    status: "active",
    startedAt: 100,
    plannedEndAt: 200,
    outcome: null
  };

  it("records an early re-enable as dependency evidence", () => {
    const transition = reconcileTrialObservation(active, { exists: true, enabled: true }, 150);
    expect(transition.outcome).toBe("needed");
    expect(applyTrialOutcome(active, transition)).toMatchObject({ active: false, outcome: "needed", endedAt: 150 });
  });

  it("records surviving the whole disabled period as cleanup evidence", () => {
    expect(reconcileTrialObservation(active, { exists: true, enabled: false }, 201).outcome).toBe("survived-trial");
  });

  it("records disappearance as uninstall evidence without attributing causality", () => {
    expect(reconcileTrialObservation(active, { exists: false, enabled: false }, 150).outcome).toBe("uninstalled");
  });

  it("does nothing while an active trial is still running and disabled", () => {
    expect(reconcileTrialObservation(active, { exists: true, enabled: false }, 150)).toBeNull();
  });
});

describe("decision confidence and portfolio impact", () => {
  it("keeps capability exposure separate from usefulness confidence", () => {
    const item = extension({ permissions: ["debugger"], hostPermissions: ["<all_urls>"] });
    const confidence = decisionConfidence(item, {});
    expect(confidence.level).toBe("low");
    expect(confidence.reasons.join(" ")).toContain("does not establish usefulness");
  });

  it("counts only enabled extensions in current cleanup attack-surface impact", () => {
    const enabled = extension({ id: "enabled", permissions: ["scripting"], hostPermissions: ["<all_urls>"] });
    const disabled = extension({ id: "disabled", enabled: false, permissions: ["debugger"], hostPermissions: ["<all_urls>"] });
    const impact = cleanupImpact([enabled, disabled], {
      enabled: { verdict: "unnecessary" },
      disabled: { verdict: "unnecessary" }
    });

    expect(impact.enabledExtensions).toBe(1);
    expect(impact.enabledHighExposure).toBe(1);
    expect(impact.reviewCandidates).toBe(1);
    expect(impact.highConfidenceCleanupCandidates).toBe(1);
  });

  it("summarizes explicit cleanup verdicts and trial evidence independently", () => {
    const one = extension({ id: "one" });
    const two = extension({ id: "two", enabled: false });
    const summary = portfolioSummary([one, two], {
      one: { verdict: "unnecessary" },
      two: { trial: { outcome: "needed" } }
    });

    expect(summary.installed).toBe(2);
    expect(summary.enabled).toBe(1);
    expect(summary.disabled).toBe(1);
    expect(summary.highConfidenceReviews).toBe(1);
  });
});
