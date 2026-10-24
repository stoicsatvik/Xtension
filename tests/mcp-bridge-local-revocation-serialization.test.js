import { afterEach, expect, it, vi } from "vitest";

const CONFIG = "xtension.mcp.v1";
const PREFS = "xtension.preferences.v1";
const APPROVALS = "xtension.mcp.approvals.v1";
const EXTENSION = "a".repeat(32);
const TOKEN_A = "a".repeat(64);
const TOKEN_B = "b".repeat(64);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function until(predicate) {
  const deadline = Date.now() + 2000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("Controlled storage barrier was not reached");
    await sleep(5);
  }
}

function harness(pausedKey = null) {
  const stored = { [CONFIG]: { enabled: true, token: TOKEN_A } };
  const messages = [];
  const heldWrites = [];
  const writes = [];
  let pauseNext = Boolean(pausedKey);

  vi.stubGlobal("chrome", {
    storage: {
      local: {
        get: async (keys) => {
          const names = Array.isArray(keys) ? keys : [keys];
          return Object.fromEntries(names.map((key) => [key, stored[key]]));
        },
        set: async (updates) => {
          for (const [key, value] of Object.entries(updates)) {
            if (pauseNext && key === pausedKey) {
              pauseNext = false;
              await new Promise((resolve) => heldWrites.push(resolve));
            }
            stored[key] = value;
            writes.push({ key, value });
          }
        },
        remove: async (keys) => {
          for (const key of (Array.isArray(keys) ? keys : [keys])) {
            delete stored[key];
            writes.push({ key, removed: true });
          }
        }
      },
      onChanged: { addListener: () => {} }
    },
    runtime: {
      id: "e227-test",
      getURL: (path) => `chrome-extension://e227-test/${path}`,
      sendMessage: vi.fn(async () => ({ ok: true })),
      onMessage: { addListener: (listener) => messages.push(listener) }
    }
  });
  vi.stubGlobal("fetch", vi.fn(async (url) => {
    if (String(url).endsWith("/v1/sync")) {
      return { ok: true, json: async () => ({ status: { lastSyncAt: 1 } }) };
    }
    if (String(url).includes("/v1/commands?wait=")) return new Promise(() => {});
    throw new Error(`Unexpected bridge request: ${url}`);
  }));

  function send(type, extra = {}) {
    return new Promise((resolve, reject) => {
      const sender = { id: "e227-test", url: "chrome-extension://e227-test/dashboard.html" };
      const handler = messages.find((fn) => fn({ type, ...extra }, sender, resolve));
      if (!handler) reject(new Error(`No handler for ${type}`));
    });
  }
  return {
    stored, writes, send,
    get held() { return heldWrites.length; },
    release() {
      if (!heldWrites.length) throw new Error("No suspended storage write");
      heldWrites.shift()();
    }
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

it("disconnect waits for an already-started preference commit before reporting revocation", async () => {
  vi.resetModules();
  const h = harness(PREFS);
  const { executeCommandOnce } = await import("../agent/background-mcp-bridge.js");
  const action = executeCommandOnce({
    id: "e227-pref", type: "set-verdict",
    payload: { extensionId: EXTENSION, verdict: "unnecessary" }
  });
  await until(() => h.held === 1);

  let disconnected = false;
  const disconnect = h.send("mcp:disconnect").then((result) => {
    disconnected = true;
    return result;
  });
  await sleep(30);
  expect(disconnected).toBe(false);
  expect(h.stored[CONFIG].token).toBe(TOKEN_A);

  h.release();
  expect((await action).ok).toBe(true);
  expect((await disconnect).connected).toBe(false);
  expect(h.stored[CONFIG]).toBeUndefined();
  expect(h.writes.findIndex((item) => item.key === PREFS))
    .toBeLessThan(h.writes.findIndex((item) => item.key === CONFIG && item.removed));
});

it("disconnect clears approvals only after an in-flight approval-store commit", async () => {
  vi.resetModules();
  const h = harness(APPROVALS);
  const { executeCommandOnce } = await import("../agent/background-mcp-bridge.js");
  const action = executeCommandOnce({
    id: "e227-approval", type: "uninstall-extension",
    payload: { extensionId: EXTENSION }
  });
  await until(() => h.held === 1);

  let disconnected = false;
  const disconnect = h.send("mcp:disconnect").then((result) => {
    disconnected = true;
    return result;
  });
  await sleep(30);
  expect(disconnected).toBe(false);
  expect(h.stored[CONFIG].token).toBe(TOKEN_A);

  h.release();
  expect(await action).toBeNull();
  expect((await disconnect).connected).toBe(false);
  expect(h.stored[APPROVALS]).toBeUndefined();
  expect(h.stored[CONFIG]).toBeUndefined();
});

it("local token rotation waits for an already-started preference commit", async () => {
  vi.resetModules();
  const h = harness(PREFS);
  const { executeCommandOnce } = await import("../agent/background-mcp-bridge.js");
  const action = executeCommandOnce({
    id: "e227-rotate", type: "set-verdict",
    payload: { extensionId: EXTENSION, verdict: "optional" }
  });
  await until(() => h.held === 1);

  let configured = false;
  const configure = h.send("mcp:configure", { token: TOKEN_B }).then((result) => {
    configured = true;
    return result;
  });
  await sleep(30);
  expect(configured).toBe(false);
  expect(h.stored[CONFIG].token).toBe(TOKEN_A);

  h.release();
  expect((await action).ok).toBe(true);
  expect((await configure).connected).toBe(true);
  expect(h.stored[CONFIG].token).toBe(TOKEN_B);
});

it("idle disconnect still completes and clears pairing", async () => {
  vi.resetModules();
  const h = harness();
  await import("../agent/background-mcp-bridge.js");
  expect((await h.send("mcp:disconnect")).connected).toBe(false);
  expect(h.stored[CONFIG]).toBeUndefined();
});
