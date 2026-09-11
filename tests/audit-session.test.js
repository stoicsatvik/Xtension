import { describe, expect, it } from "vitest";
import {
  AUDIT_SESSION_MAX_AGE_MS,
  newAuditSession,
  normalizeAuditSession,
  serializeAuditSession
} from "../agent/audit-session.js";

describe("audit session persistence", () => {
  it("restores only extension ids that still exist", () => {
    const now = 1_000_000;
    const restored = normalizeAuditSession(
      {
        startedAt: now - 1000,
        decisions: 3,
        skippedIds: ["one", "missing", "one", "two"]
      },
      ["one", "two"],
      now
    );

    expect(restored.decisions).toBe(3);
    expect(restored.skippedIds).toEqual(["one", "two"]);
  });

  it("starts fresh when a stored session is stale", () => {
    const now = AUDIT_SESSION_MAX_AGE_MS + 10_000;
    const restored = normalizeAuditSession(
      { startedAt: 1, decisions: 9, skippedIds: ["one"] },
      ["one"],
      now
    );

    expect(restored.decisions).toBe(0);
    expect(restored.skippedIds).toEqual([]);
    expect(restored.startedAt).toBe(now);
  });

  it("serializes decisions and unique skipped ids without browser data", () => {
    const payload = serializeAuditSession({
      startedAt: 123,
      decisions: 4.9,
      skipped: new Set(["one", "two"])
    });

    expect(payload).toEqual({
      startedAt: 123,
      decisions: 4,
      skippedIds: ["one", "two"]
    });
    expect(JSON.stringify(payload)).not.toContain("history");
  });

  it("creates a minimal new session", () => {
    expect(newAuditSession(42)).toEqual({ startedAt: 42, decisions: 0, skippedIds: [] });
  });
});
