import { describe, expect, it } from "vitest";
import { commandFingerprint, executeJournaledCommand, serializeCommandExecutions } from "../agent/mcp-command-journal.js";
import { shouldRestartMcpLoop } from "../agent/mcp-bridge-policy.js";

const cmd = { id: "cmd-1", type: "start-trial", payload: { extensionId: "abc", days: 7 } };
function harness() {
  let records = [], effects = 0, saves = 0, failAt = 0;
  const io = {
    load: async () => records,
    save: async (next) => {
      saves++;
      if (saves === failAt) throw new Error("injected storage failure");
      records = JSON.parse(JSON.stringify(next));
    },
    execute: async () => { effects++; return { disabled: true }; }
  };
  return { io, stats: () => ({ records, effects, saves }), fail: (n) => { failAt = n; }, seed: (x) => { records = x; } };
}

describe("E455 durable MCP command fence", () => {
  it("persists intent, completion and deduplicates delivery", async () => {
    const h = harness();
    const first = await executeJournaledCommand(cmd, h.io);
    expect(first.ok).toBe(true);
    expect(await executeJournaledCommand(cmd, h.io)).toEqual(first);
    expect(h.stats().effects).toBe(1);
    expect(h.stats().saves).toBe(2);
    expect(h.stats().records[0].status).toBe("completed");
  });
  it("refuses effects if the intent write fails", async () => {
    const h = harness(); h.fail(1);
    await expect(executeJournaledCommand(cmd, h.io)).rejects.toThrow(/injected/);
    expect(h.stats().effects).toBe(0);
  });
  it("does not replay after a post-effect receipt failure", async () => {
    const h = harness(); h.fail(2);
    expect((await executeJournaledCommand(cmd, h.io)).uncertain).toBe(true);
    expect((await executeJournaledCommand(cmd, h.io)).uncertain).toBe(true);
    expect(h.stats().effects).toBe(1);
    expect(h.stats().records[0].status).toBe("pending");
  });
  it("does not replay a pending command after worker restart", async () => {
    const h = harness();
    h.seed([{ id: cmd.id, fingerprint: commandFingerprint(cmd), status: "pending" }]);
    expect((await executeJournaledCommand(cmd, h.io)).uncertain).toBe(true);
    expect(h.stats().effects).toBe(0);
  });
  it("refuses reused IDs with different payloads", async () => {
    const h = harness(); await executeJournaledCommand(cmd, h.io);
    expect((await executeJournaledCommand({ ...cmd, payload: { days: 30 } }, h.io)).conflict).toBe(true);
    expect(h.stats().effects).toBe(1);
  });
  it("serializes concurrent duplicate deliveries", async () => {
    const h = harness();
    const once = serializeCommandExecutions((c) => executeJournaledCommand(c, h.io));
    const results = await Promise.all([once(cmd), once(cmd), once(cmd)]);
    expect(results.every((x) => x.ok)).toBe(true);
    expect(h.stats().effects).toBe(1);
  });
  it("refuses journal overflow rather than evicting receipts", async () => {
    const h = harness(); await executeJournaledCommand(cmd, h.io, { maxEntries: 1 });
    expect((await executeJournaledCommand({ ...cmd, id: "cmd-2" }, h.io, { maxEntries: 1 })).blocked).toBe(true);
    expect(h.stats().effects).toBe(1);
  });
  it("fails closed on corrupt storage, malformed ID and legacy receipts", async () => {
    const h = harness(); h.seed(null);
    await expect(executeJournaledCommand(cmd, h.io)).rejects.toThrow(/corrupt/);
    await expect(executeJournaledCommand({ ...cmd, id: "" }, h.io)).rejects.toThrow(/ID/);
    h.seed([{ id: cmd.id, fingerprint: "legacy-unverified", status: "pending" }]);
    expect((await executeJournaledCommand(cmd, h.io)).uncertain).toBe(true);
    expect(h.stats().effects).toBe(0);
  });
  it("canonicalizes payload object key order", () => {
    expect(commandFingerprint(cmd)).toBe(commandFingerprint({ ...cmd, payload: { days: 7, extensionId: "abc" } }));
  });
  it("persists failure results without replay", async () => {
    const h = harness(); h.io.execute = async () => { throw new Error("Chrome denied action"); };
    const first = await executeJournaledCommand(cmd, h.io);
    expect(first).toEqual({ ok: false, error: "Chrome denied action" });
    expect(await executeJournaledCommand(cmd, h.io)).toEqual(first);
  });
});

describe("E455 long-poll lifecycle", () => {
  it("ignores status-only telemetry updates", () => {
    const c = { enabled: true, token: "token", lastSyncAt: 100 };
    expect(shouldRestartMcpLoop(c, { ...c, lastSyncAt: 200 })).toBe(false);
    expect(shouldRestartMcpLoop(c, { ...c, lastError: "timeout" })).toBe(false);
  });
  it("restarts only for enable/disable and token changes", () => {
    const c = { enabled: true, token: "token" };
    expect(shouldRestartMcpLoop(c, c)).toBe(false);
    expect(shouldRestartMcpLoop(c, { ...c, token: "new" })).toBe(true);
    expect(shouldRestartMcpLoop(c, null)).toBe(true);
    expect(shouldRestartMcpLoop(null, c)).toBe(true);
  });
});
