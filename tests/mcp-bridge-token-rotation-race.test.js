import { afterEach, expect, it, vi } from "vitest";

const KEY = "xtension.mcp.v1";
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

it("a late sync from a revoked token cannot overwrite the rotated token", async () => {
  vi.resetModules();
  const listeners = [];
  const tokenA = "a".repeat(64);
  const tokenB = "b".repeat(64);
  const stored = { [KEY]: { enabled: true, token: tokenA } };
  let resolveOldSync;
  const oldSync = new Promise((resolve) => { resolveOldSync = resolve; });
  let requestsA = 0;
  let requestsB = 0;

  vi.stubGlobal("chrome", {
    storage: {
      local: {
        get: async (keys) => {
          const names = Array.isArray(keys) ? keys : [keys];
          return Object.fromEntries(names.map((name) => [name, stored[name]]));
        },
        set: async (updates) => {
          const oldValue = stored[KEY];
          Object.assign(stored, updates);
          if (Object.hasOwn(updates, KEY)) {
            for (const listener of listeners) {
              listener({ [KEY]: { oldValue, newValue: stored[KEY] } }, "local");
            }
          }
        },
        remove: async (keys) => {
          for (const name of (Array.isArray(keys) ? keys : [keys])) delete stored[name];
        }
      },
      onChanged: { addListener: (listener) => listeners.push(listener) }
    },
    runtime: {
      id: "e223-test",
      getURL: (name) => `chrome-extension://e223-test/${name}`,
      onMessage: { addListener: () => {} }
    }
  });

  vi.stubGlobal("fetch", vi.fn(async (url, options) => {
    if (String(url).includes("/v1/commands")) return new Promise(() => {});
    if (!String(url).endsWith("/v1/sync")) throw new Error(`Unexpected URL ${url}`);
    const authorization = options?.headers?.authorization;
    if (authorization === `Bearer ${tokenA}`) {
      requestsA++;
      return oldSync;
    }
    if (authorization === `Bearer ${tokenB}`) {
      requestsB++;
      return { ok: true, json: async () => ({ status: { lastSyncAt: 200 } }) };
    }
    throw new Error("Unexpected token");
  }));

  await import("../agent/background-mcp-bridge.js");
  await wait(40);
  expect(requestsA).toBe(1);

  // The old request remains pending while a new pairing is established.
  await chrome.storage.local.set({
    [KEY]: { ...stored[KEY], token: tokenB }
  });
  await wait(40);
  expect(requestsB).toBe(1);
  expect(stored[KEY].token).toBe(tokenB);

  // The old request now succeeds out of order. It must not roll back pairing.
  resolveOldSync({ ok: true, json: async () => ({ status: { lastSyncAt: 100 } }) });
  await wait(50);
  expect(stored[KEY].token).toBe(tokenB);
  expect(stored[KEY].lastError).toBeNull();
});
