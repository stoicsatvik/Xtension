import { afterEach, expect, it, vi } from "vitest";

const CONFIG = "xtension.mcp.v1";
const PREFS = "xtension.preferences.v1";
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const command = (id) => ({
  id, type: "set-verdict", payload: { extensionId: "a".repeat(32), verdict: "unnecessary" }
});

async function waitFor(predicate) {
  const deadline = Date.now() + 600;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("Timed out waiting for test barrier");
    await wait(5);
  }
}

function harness() {
  const tokenA = "a".repeat(64);
  const tokenB = "b".repeat(64);
  const stored = { [CONFIG]: { enabled: true, token: tokenA } };
  const listeners = [];
  const pollResolvers = new Map();
  const acks = [];
  const polls = [];
  let mutationCount = 0;
  const onChange = (key, oldValue, newValue) => {
    for (const listener of listeners) listener({ [key]: { oldValue, newValue } }, "local");
  };

  vi.stubGlobal("chrome", {
    storage: {
      local: {
        get: async (keys) => {
          const names = Array.isArray(keys) ? keys : [keys];
          return Object.fromEntries(names.map((key) => [key, stored[key]]));
        },
        set: async (updates) => {
          for (const [key, value] of Object.entries(updates)) {
            const oldValue = stored[key];
            stored[key] = value;
            if (key === PREFS) mutationCount++;
            onChange(key, oldValue, value);
          }
        },
        remove: async (keys) => {
          for (const key of (Array.isArray(keys) ? keys : [keys])) {
            const oldValue = stored[key];
            delete stored[key];
            onChange(key, oldValue, undefined);
          }
        }
      },
      onChanged: { addListener: (listener) => listeners.push(listener) }
    },
    runtime: {
      id: "e224-test",
      getURL: (path) => `chrome-extension://e224-test/${path}`,
      onMessage: { addListener: () => {} }
    }
  });

  vi.stubGlobal("fetch", vi.fn(async (url, options = {}) => {
    const path = String(url);
    const token = String(options.headers?.authorization ?? "").replace(/^Bearer /, "");
    if (path.endsWith("/v1/sync")) {
      return { ok: true, json: async () => ({ status: { lastSyncAt: 100 } }) };
    }
    if (path.includes("/v1/commands/") && path.endsWith("/result")) {
      acks.push({ path, token });
      return { ok: true, json: async () => ({ ok: true }) };
    }
    if (path.includes("/v1/commands?wait=")) {
      polls.push(token);
      // Each generation parks at an explicit test-controlled response barrier.
      return new Promise((resolve) => {
        if (!pollResolvers.has(token)) pollResolvers.set(token, []);
        pollResolvers.get(token).push(resolve);
      });
    }
    throw new Error(`Unexpected request ${path}`);
  }));

  return {
    tokenA, tokenB, stored, acks, polls,
    get mutationCount() { return mutationCount; },
    async respond(token, commands) {
      await waitFor(() => (pollResolvers.get(token)?.length ?? 0) > 0);
      pollResolvers.get(token).shift()({
        ok: true, json: async () => ({ commands })
      });
    },
    async rotate() {
      await chrome.storage.local.set({ [CONFIG]: { ...stored[CONFIG], token: tokenB } });
    },
    async disconnect() {
      await chrome.storage.local.remove(CONFIG);
    }
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

it.each(["rotate", "disconnect"])(
  "discards commands returned by a revoked long poll after %s",
  async (transition) => {
    vi.resetModules();
    const h = harness();
    await import("../agent/background-mcp-bridge.js");
    await waitFor(() => h.polls.includes(h.tokenA));
    await h[transition]();
    if (transition === "rotate") await waitFor(() => h.polls.includes(h.tokenB));

    await h.respond(h.tokenA, [command(`stale-${transition}`)]);
    await wait(40);
    expect(h.mutationCount).toBe(0);
    expect(h.stored[PREFS]).toBeUndefined();
    expect(h.acks).toHaveLength(0);
    if (transition === "rotate") expect(h.stored[CONFIG].token).toBe(h.tokenB);
    else expect(h.stored[CONFIG]).toBeUndefined();
  }
);

it("still processes a command returned by the current pairing", async () => {
  vi.resetModules();
  const h = harness();
  await import("../agent/background-mcp-bridge.js");
  await waitFor(() => h.polls.includes(h.tokenA));
  await h.respond(h.tokenA, [command("current-command")]);
  await waitFor(() => h.acks.length === 1);
  expect(h.mutationCount).toBe(1);
  expect(h.stored[PREFS]["a".repeat(32)].verdict).toBe("unnecessary");
  expect(h.acks[0].token).toBe(h.tokenA);
});
