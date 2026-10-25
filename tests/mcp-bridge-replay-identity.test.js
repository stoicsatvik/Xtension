import { afterEach, expect, it, vi } from "vitest";

const CACHE = "xtension.mcp.command-results.v1";
const PREFS = "xtension.preferences.v1";
const EXTENSION = "a".repeat(32);
const TOKEN_A = "a".repeat(64);
const TOKEN_B = "b".repeat(64);

function harness(initial = {}) {
  const stored = { ...initial };
  let preferenceWrites = 0;
  vi.stubGlobal("chrome", {
    storage: {
      local: {
        get: async (keys) => {
          const names = Array.isArray(keys) ? keys : [keys];
          return Object.fromEntries(names.map((key) => [key, stored[key]]));
        },
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
      id: "e230-test",
      getURL: (path) => `chrome-extension://e230-test/${path}`,
      sendMessage: vi.fn(async () => ({ ok: true })),
      onMessage: { addListener: () => {} }
    }
  });
  return { stored, get preferenceWrites() { return preferenceWrites; } };
}

const command = (id, verdict = "essential") => ({
  id, type: "set-verdict", payload: { extensionId: EXTENSION, verdict }
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

it("replays identical command and pairing without repeating the browser mutation", async () => {
  const h = harness();
  const { executeCommandOnce } = await import("../agent/background-mcp-bridge.js");
  const first = await executeCommandOnce(command("repeat"), async () => true, TOKEN_A);
  const second = await executeCommandOnce(command("repeat"), async () => true, TOKEN_A);
  expect(first.ok).toBe(true);
  expect(second).toEqual(first);
  expect(h.preferenceWrites).toBe(1);
});

it("rejects reused command IDs with different payloads instead of returning a false success", async () => {
  const h = harness();
  const { executeCommandOnce } = await import("../agent/background-mcp-bridge.js");
  expect((await executeCommandOnce(command("collision"), async () => true, TOKEN_A)).ok).toBe(true);
  const conflicting = await executeCommandOnce(command("collision", "unnecessary"), async () => true, TOKEN_A);
  expect(conflicting.ok).toBe(false);
  expect(conflicting.error).toMatch(/identity|collision|reused|different/i);
  expect(h.preferenceWrites).toBe(1);
  expect(h.stored[PREFS][EXTENSION].verdict).toBe("essential");
});

it("rejects reused command IDs after pairing rotation even with identical payload", async () => {
  const h = harness();
  const { executeCommandOnce } = await import("../agent/background-mcp-bridge.js");
  expect((await executeCommandOnce(command("rotation"), async () => true, TOKEN_A)).ok).toBe(true);
  const conflicting = await executeCommandOnce(command("rotation"), async () => true, TOKEN_B);
  expect(conflicting.ok).toBe(false);
  expect(conflicting.error).toMatch(/identity|collision|reused|different/i);
  expect(h.preferenceWrites).toBe(1);
});

it("fails closed for legacy unscoped receipts instead of silently replaying or executing", async () => {
  const h = harness({
    [CACHE]: [{ id: "legacy", result: { ok: true, value: { ok: true } }, completedAt: 100 }]
  });
  const { executeCommandOnce } = await import("../agent/background-mcp-bridge.js");
  const result = await executeCommandOnce(command("legacy"), async () => true, TOKEN_A);
  expect(result.ok).toBe(false);
  expect(result.error).toMatch(/legacy|reconcile|identity/i);
  expect(h.preferenceWrites).toBe(0);
});

it("allows a new command ID to execute under the same pairing", async () => {
  const h = harness();
  const { executeCommandOnce } = await import("../agent/background-mcp-bridge.js");
  expect((await executeCommandOnce(command("one"), async () => true, TOKEN_A)).ok).toBe(true);
  expect((await executeCommandOnce(command("two", "unnecessary"), async () => true, TOKEN_A)).ok).toBe(true);
  expect(h.preferenceWrites).toBe(2);
  expect(h.stored[PREFS][EXTENSION].verdict).toBe("unnecessary");
});

it("treats equivalent JSON payloads with different key ordering as the same replay", async () => {
  const h = harness();
  const { executeCommandOnce } = await import("../agent/background-mcp-bridge.js");
  const first = { id: "ordered", type: "set-verdict",
    payload: { extensionId: EXTENSION, verdict: "essential" } };
  const reordered = { id: "ordered", type: "set-verdict",
    payload: { verdict: "essential", extensionId: EXTENSION } };
  expect((await executeCommandOnce(first, async () => true, TOKEN_A)).ok).toBe(true);
  expect((await executeCommandOnce(reordered, async () => true, TOKEN_A)).ok).toBe(true);
  expect(h.preferenceWrites).toBe(1);
});

it("persists only a digest, never the raw bearer token, in the replay cache", async () => {
  const h = harness();
  const { executeCommandOnce } = await import("../agent/background-mcp-bridge.js");
  expect((await executeCommandOnce(command("secret"), async () => true, TOKEN_A)).ok).toBe(true);
  const records = h.stored[CACHE];
  expect(records).toHaveLength(1);
  expect(records[0].fingerprint).toMatch(/^[a-f0-9]{64}$/);
  expect(JSON.stringify(records)).not.toContain(TOKEN_A);
});
