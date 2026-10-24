import { afterEach, expect, it, vi } from "vitest";

const CONFIG = "xtension.mcp.v1";
const PREFS = "xtension.preferences.v1";
const TOKEN_A = "a".repeat(64);
const TOKEN_B = "b".repeat(64);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function until(predicate) {
  const deadline = Date.now() + 2000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("Snapshot read barrier not reached");
    await sleep(5);
  }
}

function harness({ holdFirstSnapshot = true } = {}) {
  const stored = {};
  const messages = [];
  const syncTokens = [];
  const heldSnapshots = [];
  let pauseNext = holdFirstSnapshot;

  vi.stubGlobal("chrome", {
    storage: {
      local: {
        get: async (keys) => {
          const names = Array.isArray(keys) ? keys : [keys];
          if (pauseNext && names.includes(PREFS)) {
            pauseNext = false;
            return new Promise((resolve) => heldSnapshots.push(() =>
              resolve(Object.fromEntries(names.map((key) => [key, stored[key]])))));
          }
          return Object.fromEntries(names.map((key) => [key, stored[key]]));
        },
        set: async (updates) => Object.assign(stored, updates),
        remove: async (keys) => {
          for (const key of (Array.isArray(keys) ? keys : [keys])) delete stored[key];
        }
      },
      onChanged: { addListener: () => {} }
    },
    runtime: {
      id: "e228-test",
      getURL: (path) => `chrome-extension://e228-test/${path}`,
      sendMessage: vi.fn(async () => ({ ok: true })),
      onMessage: { addListener: (listener) => messages.push(listener) }
    }
  });
  vi.stubGlobal("fetch", vi.fn(async (url, options) => {
    if (!String(url).endsWith("/v1/sync")) throw new Error(`Unexpected request: ${url}`);
    syncTokens.push(options.headers.authorization.replace("Bearer ", ""));
    return { ok: true, json: async () => ({ status: { lastSyncAt: 1 } }) };
  }));

  function send(type, extra = {}) {
    return new Promise((resolve, reject) => {
      const sender = { id: "e228-test", url: "chrome-extension://e228-test/dashboard.html" };
      const handled = messages.some((listener) => listener({ type, ...extra }, sender, resolve));
      if (!handled) reject(new Error(`Unhandled message: ${type}`));
    });
  }
  return {
    stored, syncTokens, send,
    get held() { return heldSnapshots.length; },
    releaseSnapshot() {
      if (!heldSnapshots.length) throw new Error("No held snapshot");
      heldSnapshots.shift()();
    }
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

it("does not send evidence under token A after local pairing rotated to B during snapshot read", async () => {
  vi.resetModules();
  const h = harness();
  await import("../agent/background-mcp-bridge.js");
  const first = h.send("mcp:configure", { token: TOKEN_A });
  await until(() => h.held === 1);
  const second = await h.send("mcp:configure", { token: TOKEN_B });
  expect(second.connected).toBe(true);
  expect(h.stored[CONFIG].token).toBe(TOKEN_B);
  h.releaseSnapshot();
  const old = await first;
  expect(old.connected).toBe(false);
  expect(h.syncTokens).toEqual([TOKEN_B]);
});

it("does not send evidence under a disconnected pairing after delayed snapshot read", async () => {
  vi.resetModules();
  const h = harness();
  await import("../agent/background-mcp-bridge.js");
  const pending = h.send("mcp:configure", { token: TOKEN_A });
  await until(() => h.held === 1);
  expect((await h.send("mcp:disconnect")).connected).toBe(false);
  h.releaseSnapshot();
  expect((await pending).connected).toBe(false);
  expect(h.syncTokens).toEqual([]);
});

it("still synchronizes an unchanged pairing", async () => {
  vi.resetModules();
  const h = harness({ holdFirstSnapshot: false });
  await import("../agent/background-mcp-bridge.js");
  expect((await h.send("mcp:configure", { token: TOKEN_A })).connected).toBe(true);
  expect(h.syncTokens).toEqual([TOKEN_A]);
});
