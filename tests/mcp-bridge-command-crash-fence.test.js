import { afterEach, expect, it, vi } from "vitest";

const CACHE = "xtension.mcp.command-results.v1";
const PREFS = "xtension.preferences.v1";
const EXTENSION = "a".repeat(32);
const TOKEN = "c".repeat(64);
const command = (id) => ({
  id, type: "set-verdict",
  payload: { extensionId: EXTENSION, verdict: "essential" }
});

function harness({ failFinalReceiptOnce = false, failIntentOnce = false } = {}) {
  const stored = {};
  let preferenceWrites = 0;
  let receiptWrites = 0;
  const state = { failFinalReceiptOnce, failIntentOnce };
  vi.stubGlobal("chrome", {
    storage: {
      local: {
        get: async (keys) => {
          const names = Array.isArray(keys) ? keys : [keys];
          return Object.fromEntries(names.map((key) => [key, stored[key]]));
        },
        set: async (updates) => {
          if (Object.hasOwn(updates, CACHE)) {
            const intent = updates[CACHE]?.[0]?.phase === "pending";
            if (intent && state.failIntentOnce) {
              state.failIntentOnce = false;
              throw new Error("injected durable-intent write failure");
            }
            if (!intent && state.failFinalReceiptOnce) {
              state.failFinalReceiptOnce = false;
              throw new Error("injected completion-receipt write failure");
            }
            receiptWrites++;
          }
          if (Object.hasOwn(updates, PREFS)) preferenceWrites++;
          Object.assign(stored, updates);
        },
        remove: async (keys) => {
          for (const key of (Array.isArray(keys) ? keys : [keys])) delete stored[key];
        }
      },
      onChanged: { addListener: () => {} }
    },
    runtime: {
      id: "e231-test",
      getURL: (path) => `chrome-extension://e231-test/${path}`,
      sendMessage: vi.fn(async () => ({ ok: true })),
      onMessage: { addListener: () => {} }
    }
  });
  return {
    stored,
    get preferenceWrites() { return preferenceWrites; },
    get receiptWrites() { return receiptWrites; }
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

it("does not repeat a committed browser mutation after its completion receipt fails and the worker restarts", async () => {
  const h = harness({ failFinalReceiptOnce: true });
  const firstWorker = await import("../agent/background-mcp-bridge.js");
  await expect(firstWorker.executeCommandOnce(command("crash"), async () => true, TOKEN))
    .rejects.toThrow(/completion-receipt/);
  expect(h.preferenceWrites).toBe(1);
  expect(h.stored[CACHE]?.[0]?.phase).toBe("pending");

  vi.resetModules(); // fresh module state; Chrome storage survives the restart
  const secondWorker = await import("../agent/background-mcp-bridge.js");
  const replay = await secondWorker.executeCommandOnce(command("crash"), async () => true, TOKEN);
  expect(replay?.ok).toBe(false);
  expect(replay?.error).toMatch(/pending|uncertain|reconcil/i);
  expect(h.preferenceWrites).toBe(1);
  expect(h.stored[PREFS][EXTENSION].verdict).toBe("essential");
});

it("never starts a browser mutation when the durable intent cannot be written", async () => {
  const h = harness({ failIntentOnce: true });
  const { executeCommandOnce } = await import("../agent/background-mcp-bridge.js");
  await expect(executeCommandOnce(command("no-intent"), async () => true, TOKEN))
    .rejects.toThrow(/durable-intent/);
  expect(h.preferenceWrites).toBe(0);
  expect(h.stored[CACHE]).toBeUndefined();
});

it("commits a completed receipt and replays it without repeating a mutation", async () => {
  const h = harness();
  const { executeCommandOnce } = await import("../agent/background-mcp-bridge.js");
  const first = await executeCommandOnce(command("complete"), async () => true, TOKEN);
  expect(first?.ok).toBe(true);
  expect(h.receiptWrites).toBe(2);
  expect(h.stored[CACHE][0].phase).toBe("completed");
  vi.resetModules();
  const { executeCommandOnce: replay } = await import("../agent/background-mcp-bridge.js");
  expect(await replay(command("complete"), async () => true, TOKEN)).toEqual(first);
  expect(h.preferenceWrites).toBe(1);
});
