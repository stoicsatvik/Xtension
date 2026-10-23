import { describe, expect, it } from "vitest";
import {
  MCP_APPROVAL_TTL_MS, approvalFingerprint, approvalState,
  consumeMcpApproval, decideMcpApproval, pendingMcpApproval, requiresMcpApproval
} from "../agent/mcp-approval-policy.js";

const id = "abcdefghijklmnopabcdefghijklmnop";
const command = (type = "start-trial", days = 7, commandId = "c1") => ({
  id: commandId, type, payload: { extensionId: id, days }
});

describe("local MCP action consent", () => {
  it("requires consent for Chrome state changes, not read-only queries or verdicts", () => {
    expect(requiresMcpApproval("start-trial")).toBe(true);
    expect(requiresMcpApproval("restore-extension")).toBe(true);
    expect(requiresMcpApproval("uninstall-extension")).toBe(true);
    expect(requiresMcpApproval("set-verdict")).toBe(false);
  });

  it("is denied by default and grants one exact command once", () => {
    const request = command();
    const records = { c1: pendingMcpApproval(request, 1000) };
    expect(approvalState(records, request, 1001)).toBe("pending");
    const approved = decideMcpApproval(records, "c1", "approved", 1002);
    expect(approvalState(approved, request, 1003)).toBe("approved");
    const consumed = consumeMcpApproval(approved, "c1", 1004);
    expect(approvalState(consumed, request, 1005)).toBe("consumed");
    expect(() => consumeMcpApproval(consumed, "c1", 1006)).toThrow();
  });

  it("binds approval to exact extension, action, duration and command id", () => {
    const request = command();
    const approved = decideMcpApproval({ c1: pendingMcpApproval(request, 100) }, "c1", "approved", 101);
    expect(approvalState(approved, command("start-trial", 8), 102)).toBe("mismatch");
    expect(approvalState(approved, { ...request, payload: { extensionId: "b".repeat(32), days: 7 } }, 102)).toBe("mismatch");
    expect(approvalState(approved, command("uninstall-extension"), 102)).toBe("mismatch");
    expect(approvalState(approved, command("start-trial", 7, "c2"), 102)).toBe("missing");
    expect(approvalFingerprint(request)).not.toBe(approvalFingerprint(command("start-trial", 8)));
  });

  it("rejects expired, denied and repeated decisions", () => {
    const request = command();
    const pending = { c1: pendingMcpApproval(request, 0) };
    const denied = decideMcpApproval(pending, "c1", "denied", 1);
    expect(approvalState(denied, request, 2)).toBe("denied");
    expect(() => decideMcpApproval(denied, "c1", "approved", 3)).toThrow();
    expect(approvalState(pending, request, MCP_APPROVAL_TTL_MS)).toBe("expired");
    expect(() => decideMcpApproval(pending, "c1", "approved", MCP_APPROVAL_TTL_MS)).toThrow();
  });

  it("fails closed on invalid extension ids and durations", () => {
    expect(() => pendingMcpApproval({ ...command(), payload: { extensionId: "not-an-id" } })).toThrow();
    expect(() => pendingMcpApproval(command("start-trial", 0))).toThrow();
    expect(() => pendingMcpApproval(command("start-trial", 31))).toThrow();
    expect(() => pendingMcpApproval(command("start-trial", 1.5))).toThrow();
  });
});
