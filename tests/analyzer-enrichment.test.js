import { describe, expect, it } from "vitest";
import {
  assertPrivacyPreservingEnrichment,
  buildSafeAnalyzerEnrichment
} from "../agent/analyzer-enrichment.js";

describe("privacy-preserving analyzer enrichment", () => {
  it("joins inventory, static capability and aggregate local workflow evidence", () => {
    const result = buildSafeAnalyzerEnrichment({
      inventory: [{ id: "ext-1", name: "Example", enabled: true, rawHistory: ["https://private.example"] }],
      workflowSignals: {
        "ext-1": { kind: "overlap", totalRecentPages: 12, matchedPages: 3, matchedHosts: 2, visitedUrls: ["https://private.example"] }
      },
      analyzerById: {
        "ext-1": {
          declaredPermissions: ["tabs", "history"],
          staticReferences: ["chrome.history"],
          broadHostAccess: false,
          source: "ignored"
        }
      }
    });

    expect(result).toEqual([{
      id: "ext-1",
      name: "Example",
      enabled: true,
      evidence: {
        declaredCapability: {
          declaredPermissions: ["tabs", "history"],
          staticReferences: ["chrome.history"],
          broadHostAccess: false
        },
        localWorkflowRelevance: {
          kind: "overlap",
          totalRecentPages: 12,
          matchedPages: 3,
          matchedHosts: 2
        },
        observedMaliciousBehavior: null
      }
    }]);
    expect(JSON.stringify(result)).not.toContain("private.example");
  });

  it("does not convert permissions or static references into observed malicious behavior", () => {
    const [record] = buildSafeAnalyzerEnrichment({
      inventory: [{ id: "ext-2", enabled: true }],
      analyzerById: {
        "ext-2": { declaredPermissions: ["cookies", "webRequest"], staticReferences: ["fetch"], broadHostAccess: true }
      }
    });
    expect(record.evidence.observedMaliciousBehavior).toBeNull();
  });

  it("rejects a payload that attempts to cross the raw-history boundary", () => {
    expect(() => assertPrivacyPreservingEnrichment({ historyUrls: ["https://private.example"] }))
      .toThrow(/browsing-history material is forbidden/);
  });

  it("fails closed when inventory identity is absent", () => {
    expect(() => buildSafeAnalyzerEnrichment({ inventory: [{ name: "anonymous" }] }))
      .toThrow(/extension id is required/);
  });
});
