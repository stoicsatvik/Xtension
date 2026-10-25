import { afterEach, expect, it, vi } from "vitest";
import {
  inspectCommandReplay, rememberCommandIntent, rememberCommandResult
} from "../agent/mcp-command-cache.js";

const CACHE = "xtension.mcp.command-results.v1";
const PREFS = "xtension.preferences.v1";
const EXTENSION = "a".repeat(32);
const TOKEN = "e".repeat(64);
const command = (id) => ({
  id, type: "set-verdict",
  payload: { extensionId: EXTENSION, verdict: "essential" }
});

function mockChrome() {
  const stored = {};
  let preferenceWrites = 0;
  vi.stubGlobal("chrome", {
    storage: {
      local: {
        get: async (keys) => Object.fromEntries(
          (Array.isArray(keys) ? keys : [keys]).map((key) => [key, stored[key]])
        ),
        set: async (updates) => {
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
      id: "e232-test",
      getURL: (path) => `chrome-extension://e232-test/${path}`,
      sendMessage: vi.fn(async () => ({ ok: true })),
      onMessage: { addListener: () => {} }
    }
  });
  return { stored, get preferenceWrites() { return preferenceWrites; } };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

it("refuses a new intent when all bounded slots hold completed replay evidence", () => {
  let records = rememberCommandIntent([], "one", "fp-one", 1, 2);
  records = rememberCommandResult(records, "one", { ok: true }, 2, 2, "fp-one");
  records = rememberCommandIntent(records, "two", "fp-two", 3, 2);
  records = rememberCommandResult(records, "two", { ok: true }, 4, 2, "fp-two");
  expect(() => rememberCommandIntent(records, "three", "fp-three", 5, 2))
    .toThrow(/full|reconcil|capacity/i);
  expect(inspectCommandReplay(records, "one", "fp-one").state).toBe("replay");
});

it("rejects the 101st new command before mutation, then safely replays the first", async () => {
  const h = mockChrome();
  const { executeCommandOnce } = await import("../agent/background-mcp-bridge.js");
  for (let i = 0; i < 100; i++) {
    expect((await executeCommandOnce(command(`cmd-${i}`), async () => true, TOKEN))?.ok)
      .toBe(true);
  }
  expect(h.preferenceWrites).toBe(100);
  expect(h.stored[CACHE]).toHaveLength(100);

  await expect(executeCommandOnce(command("overflow"), async () => true, TOKEN))
    .rejects.toThrow(/durable-intent|full|reconcil/i);
  expect(h.preferenceWrites).toBe(100);
  const first = await executeCommandOnce(command("cmd-0"), async () => true, TOKEN);
  expect(first?.ok).toBe(true);
  expect(h.preferenceWrites).toBe(100);
  expect(h.stored[CACHE]).toHaveLength(100);
});

it("permits an existing pending identity to remain fenced at capacity", () => {
  let records = rememberCommandIntent([], "pending", "fp-pending", 1, 2);
  records = rememberCommandResult(records, "complete", { ok: true }, 2, 2, "fp-complete");
  const renewed = rememberCommandIntent(records, "pending", "fp-pending", 3, 2);
  expect(renewed).toHaveLength(2);
  expect(inspectCommandReplay(renewed, "pending", "fp-pending").state).toBe("pending");
});
