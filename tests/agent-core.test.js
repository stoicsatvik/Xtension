import { describe, expect, it } from "vitest";
import {
  attentionPriority,
  buildRecommendation,
  deriveWorkflowSignals,
  exposureAssessment,
  findPotentialRedundancies,
  hostPatternMatchesUrl,
  inferCategory
} from "../agent/core.js";

const extension = (overrides = {}) => ({
  id: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  name: "Fixture",
  shortName: "Fixture",
  description: "Fixture extension",
  enabled: true,
  permissions: [],
  hostPermissions: [],
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
  it("matches wildcard subdomains but not unrelated domains", () => {
    expect(hostPatternMatchesUrl("https://*.github.com/*", new URL("https://gist.github.com/x"))).toBe(true);
    expect(hostPatternMatchesUrl("https://*.github.com/*", new URL("https://example.com"))).toBe(false);
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

  it("respects explicit essential verdicts while still flagging broad access", () => {
    const item = extension({ hostPermissions: ["<all_urls>"] });
    const recommendation = buildRecommendation(item, { verdict: "essential" });
    expect(recommendation.kind).toBe("keep");
    expect(recommendation.label).toContain("monitor access");
  });
});

describe("conservative redundancy evidence", () => {
  it("detects same-category enabled tools as a review hint", () => {
    const items = [
      extension({ id: "one", name: "Dark Reader" }),
      extension({ id: "two", name: "Night Mode Pro" })
    ];
    const evidence = findPotentialRedundancies(items);
    expect(inferCategory(items[0])).toBe("dark-mode");
    expect(evidence.one.category).toBe("dark-mode");
    expect(evidence.one.confidence).toBe("low");
    expect(evidence.one.peers[0].id).toBe("two");
  });

  it("does not call unrelated extensions redundant", () => {
    const items = [
      extension({ id: "one", name: "Dark Reader" }),
      extension({ id: "two", name: "Password Manager" })
    ];
    expect(findPotentialRedundancies(items)).toEqual({});
  });
});
