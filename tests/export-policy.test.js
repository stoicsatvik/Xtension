import { describe, expect, it } from "vitest";
import { LOCAL_EVIDENCE_KEYS, buildLocalEvidenceExport } from "../agent/export-policy.js";

describe("local evidence export", () => {
  it("includes longitudinal and recovery evidence", () => {
    const stored = {
      [LOCAL_EVIDENCE_KEYS.inventory]: { observedAt: 1 },
      [LOCAL_EVIDENCE_KEYS.versionHistory]: { ext: [{ version: "2" }] },
      [LOCAL_EVIDENCE_KEYS.removedExtensions]: [{ id: "ext" }],
      [LOCAL_EVIDENCE_KEYS.auditSession]: { decisions: 3 }
    };

    const payload = buildLocalEvidenceExport(stored, "2026-09-11T00:00:00.000Z");
    expect(payload.versionHistory).toEqual({ ext: [{ version: "2" }] });
    expect(payload.removedExtensions).toEqual([{ id: "ext" }]);
    expect(payload.auditSession).toEqual({ decisions: 3 });
  });

  it("explicitly excludes raw browsing history and only reads whitelisted keys", () => {
    const stored = {
      [LOCAL_EVIDENCE_KEYS.preferences]: { ext: { verdict: "essential" } },
      "xtension.raw-history.never": ["https://private.example"]
    };

    const payload = buildLocalEvidenceExport(stored);
    expect(payload.privacy.rawBrowsingHistoryIncluded).toBe(false);
    expect(JSON.stringify(payload)).not.toContain("private.example");
    expect(Object.keys(payload)).not.toContain("xtension.raw-history.never");
  });
});
