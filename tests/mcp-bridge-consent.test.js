import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ID = "abcdefghijklmnopabcdefghijklmnop";
const COMMAND = { id: "cmd-17", type: "start-trial", payload: { extensionId: ID, days: 7 } };
const APPROVALS_KEY = "xtension.mcp.approvals.v1";

let storage;
let sendMessage;
let listeners;
let executor;

beforeEach(async () => {
  vi.resetModules();
  storage = {};
  listeners = [];
  sendMessage = vi.fn(async () => ({ started: true }));
  vi.stubGlobal("chrome", {
    storage: {
      local: {
        get: vi.fn(async (keys) => {
          const names = Array.isArray(keys) ? keys : [keys];
          return Object.fromEntries(names.map((key) => [key, storage[key]]));
        }),
        set: vi.fn(async (changes) => Object.assign(storage, changes)),
        remove: vi.fn(async (keys) => {
          for (const key of (Array.isArray(keys) ? keys : [keys])) delete storage[key];
        })
      },
      onChanged: { addListener: vi.fn() }
    },
    runtime: {
      id: "xtension-test",
      getURL: (path) => `chrome-extension://xtension-test/${path}`,
      sendMessage,
      onMessage: { addListener: (fn) => listeners.push(fn) }
    }
  });
  ({ executeCommandOnce: executor } = await import("../agent/background-mcp-bridge.js"));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function message(type, senderUrl, commandId = COMMAND.id) {
  return new Promise((resolve) => {
    const listener = listeners.find((fn) => fn({ type, commandId }, { id: "xtension-test", url: senderUrl }, resolve));
    if (!listener) resolve({ error: "no listener" });
  });
}

describe("MCP bridge consent wiring with mocked Chrome", () => {
  it("never starts a disable trial before a local dashboard approval", async () => {
    expect(await executor(COMMAND)).toBeNull();
    expect(sendMessage).not.toHaveBeenCalled();
    expect(storage[APPROVALS_KEY][COMMAND.id].status).toBe("pending");

    const rejected = await message("mcp:approve", "chrome-extension://xtension-test/other.html");
    expect(rejected.error).toMatch(/Only the local/);
    expect(storage[APPROVALS_KEY][COMMAND.id].status).toBe("pending");
    expect(sendMessage).not.toHaveBeenCalled();

    const approved = await message("mcp:approve", "chrome-extension://xtension-test/dashboard.html");
    expect(approved.decision).toBe("approved");
    expect((await executor(COMMAND)).ok).toBe(true);
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage).toHaveBeenCalledWith({ type: "trial:start", extensionId: ID, days: 7 });
    expect(storage[APPROVALS_KEY][COMMAND.id].status).toBe("consumed");

    // MCP redelivery uses persisted receipt, never re-executes Chrome state.
    expect((await executor(COMMAND)).ok).toBe(true);
    expect(sendMessage).toHaveBeenCalledTimes(1);
  });

  it("acknowledges denial without changing Chrome state", async () => {
    expect(await executor(COMMAND)).toBeNull();
    const denied = await message("mcp:deny", "chrome-extension://xtension-test/dashboard.html");
    expect(denied.decision).toBe("denied");
    const result = await executor(COMMAND);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/denied/);
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("rejects changed command payload after local approval", async () => {
    expect(await executor(COMMAND)).toBeNull();
    await message("mcp:approve", "chrome-extension://xtension-test/dashboard.html");
    const changed = { ...COMMAND, payload: { extensionId: ID, days: 14 } };
    const result = await executor(changed);
    expect(result.ok).toBe(false);
    expect(sendMessage).not.toHaveBeenCalled();
  });
});
