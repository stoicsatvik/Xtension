import { afterEach, expect, it, vi } from "vitest";

const CONFIG = "xtension.mcp.v1";
const PREFS = "xtension.preferences.v1";
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const cmd = (id) => ({
  id, type: "set-verdict",
  payload: { extensionId: "a".repeat(32), verdict: "unnecessary" }
});

async function waitFor(predicate) {
  const deadline = Date.now() + 1500;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("Timed out at controlled action barrier");
    await wait(5);
  }
}

function harness({ pausePreferences = true } = {}) {
  const tokenA = "a".repeat(64), tokenB = "b".repeat(64);
  const stored = { [CONFIG]: { enabled: true, token: tokenA } };
  const listeners = [], pendingPreferences = [], pendingPolls = new Map();
  const acks = [];
  let writes = 0;

  function changed(key, oldValue, newValue) {
    for (const listener of listeners) listener({ [key]: { oldValue, newValue } }, "local");
  }
  vi.stubGlobal("chrome", {
    storage: {
      local: {
        get: async (keys) => {
          if (keys === PREFS && pausePreferences) {
            return new Promise((resolve) => pendingPreferences.push(() =>
              resolve({ [PREFS]: stored[PREFS] })));
          }
          const names = Array.isArray(keys) ? keys : [keys];
          return Object.fromEntries(names.map((key) => [key, stored[key]]));
        },
        set: async (updates) => {
          for (const [key, value] of Object.entries(updates)) {
            const oldValue = stored[key];
            stored[key] = value;
            if (key === PREFS) writes++;
            changed(key, oldValue, value);
          }
        },
        remove: async (keys) => {
          for (const key of (Array.isArray(keys) ? keys : [keys])) {
            const oldValue = stored[key];
            delete stored[key];
            changed(key, oldValue, undefined);
          }
        }
      },
      onChanged: { addListener: (listener) => listeners.push(listener) }
    },
    runtime: {
      id: "e225-test",
      getURL: (path) => `chrome-extension://e225-test/${path}`,
      onMessage: { addListener: () => {} }
    }
  });
  vi.stubGlobal("fetch", vi.fn(async (url, options = {}) => {
    const path = String(url);
    const token = String(options.headers?.authorization ?? "").replace(/^Bearer /, "");
    if (path.endsWith("/v1/sync")) {
      return { ok: true, json: async () => ({ status: { lastSyncAt: 1 } }) };
    }
    if (path.includes("/v1/commands/") && path.endsWith("/result")) {
      acks.push({ path, token });
      return { ok: true, json: async () => ({ ok: true }) };
    }
    if (path.includes("/v1/commands?wait=")) {
      return new Promise((resolve) => {
        if (!pendingPolls.has(token)) pendingPolls.set(token, []);
        pendingPolls.get(token).push(resolve);
      });
    }
    throw new Error(`Unexpected request: ${path}`);
  }));
  return {
    stored, tokenA, tokenB, acks,
    get writes() { return writes; },
    get waitingForPreferences() { return pendingPreferences.length; },
    async respond(token, commands) {
      await waitFor(() => (pendingPolls.get(token)?.length ?? 0) > 0);
      pendingPolls.get(token).shift()({
        ok: true, json: async () => ({ commands })
      });
    },
    releasePreferences() {
      if (!pendingPreferences.length) throw new Error("No preferences read to release");
      pendingPreferences.shift()();
    },
    async revoke(kind) {
      if (kind === "rotate") {
        await chrome.storage.local.set({ [CONFIG]: { enabled: true, token: tokenB } });
      } else {
        await chrome.storage.local.remove(CONFIG);
      }
    }
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

it.each(["rotate", "disconnect"])(
  "does not write preferences after %s during an in-flight preferences read",
  async (transition) => {
    vi.resetModules();
    const h = harness();
    await import("../agent/background-mcp-bridge.js");
    await h.respond(h.tokenA, [cmd(`pending-${transition}`)]);
    await waitFor(() => h.waitingForPreferences === 1);
    await h.revoke(transition);
    h.releasePreferences();
    await wait(70);
    expect(h.writes).toBe(0);
    expect(h.stored[PREFS]).toBeUndefined();
    expect(h.acks).toHaveLength(0);
    if (transition === "rotate") expect(h.stored[CONFIG].token).toBe(h.tokenB);
    else expect(h.stored[CONFIG]).toBeUndefined();
  }
);

it("retains the ability to commit a verdict under the current pairing", async () => {
  vi.resetModules();
  const h = harness({ pausePreferences: false });
  await import("../agent/background-mcp-bridge.js");
  await h.respond(h.tokenA, [cmd("current-e225")]);
  await waitFor(() => h.acks.length === 1);
  expect(h.writes).toBe(1);
  expect(h.stored[PREFS]["a".repeat(32)].verdict).toBe("unnecessary");
});
