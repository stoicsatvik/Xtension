import { describe, expect, it } from "vitest";
import {
  findCommandResult, inspectCommandReplay, rememberCommandIntent, rememberCommandResult
} from "../agent/mcp-command-cache.js";

describe("MCP command result cache", () => {
  it("replays a previously persisted result by command id", () => {
    const records = rememberCommandResult([], "cmd-1", { ok: true, value: { enabled: true } }, 1000);
    expect(findCommandResult(records, "cmd-1")).toEqual({ ok: true, value: { enabled: true } });
    expect(findCommandResult(records, "missing")).toBeNull();
  });

  it("replaces duplicate command ids and keeps the cache bounded", () => {
    let records = [];
    records = rememberCommandResult(records, "cmd-1", { ok: true, value: 1 }, 1000, 2);
    records = rememberCommandResult(records, "cmd-2", { ok: true, value: 2 }, 2000, 2);
    records = rememberCommandResult(records, "cmd-1", { ok: true, value: 3 }, 3000, 2);
    records = rememberCommandResult(records, "cmd-3", { ok: false, error: "nope" }, 4000, 2);

    expect(records).toHaveLength(2);
    expect(findCommandResult(records, "cmd-1")).toEqual({ ok: true, value: 3 });
    expect(findCommandResult(records, "cmd-2")).toBeNull();
    expect(findCommandResult(records, "cmd-3")).toEqual({ ok: false, error: "nope" });
  });
});

describe("MCP crash-intent journal", () => {
  it("retains pending intents under completed-receipt churn", () => {
    let records = rememberCommandIntent([], "uncertain", "fp-uncertain", 100, 3);
    for (let i = 0; i < 9; i++) {
      records = rememberCommandResult(records, `done-${i}`, { ok: true }, i + 101, 3, `fp-${i}`);
    }
    expect(records).toHaveLength(3);
    expect(inspectCommandReplay(records, "uncertain", "fp-uncertain")).toEqual({ state: "pending" });
    expect(inspectCommandReplay(records, "uncertain", "other")).toEqual({ state: "collision" });
  });

  it("rejects a new intent rather than evicting a full pending journal", () => {
    let records = rememberCommandIntent([], "a", "fp-a", 1, 2);
    records = rememberCommandIntent(records, "b", "fp-b", 2, 2);
    expect(() => rememberCommandIntent(records, "c", "fp-c", 3, 2))
      .toThrow(/full|reconcile/i);
    expect(records.map((entry) => entry.id)).toEqual(["b", "a"]);
  });

  it("replaces an intent with a completed result only for the same command id", () => {
    const pending = rememberCommandIntent([], "one", "fp-one", 1, 2);
    const done = rememberCommandResult(pending, "one", { ok: true }, 2, 2, "fp-one");
    expect(inspectCommandReplay(done, "one", "fp-one"))
      .toEqual({ state: "replay", result: { ok: true } });
    expect(done[0].phase).toBe("completed");
  });
});
