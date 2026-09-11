import { describe, expect, it } from "vitest";
import { findCommandResult, rememberCommandResult } from "../agent/mcp-command-cache.js";

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
