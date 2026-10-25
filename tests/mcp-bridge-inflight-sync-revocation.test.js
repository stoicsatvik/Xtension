import { afterEach, expect, it, vi } from "vitest";

const CONFIG = "xtension.mcp.v1";
const TOKEN_A = "a".repeat(64);
const TOKEN_B = "b".repeat(64);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function until(predicate) {
  const deadline = Date.now() + 2000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("E229 HTTP barrier not reached");
    await sleep(5);
  }
}

function harness() {
  const stored = {};
  const messages = [], changes = [], requests = [];

  vi.stubGlobal("chrome", {
    storage: {
      local: {
        get: async (keys) => {
          const names = Array.isArray(keys) ? keys : [keys];
          return Object.fromEntries(names.map((key) => [key, stored[key]]));
        },
        set: async (updates) => Object.assign(stored, updates),
        remove: async (keys) => {
          for (const key of (Array.isArray(keys) ? keys : [keys])) delete stored[key];
        }
      },
      onChanged: { addListener: (listener) => changes.push(listener) }
    },
    runtime: {
      id: "e229-test",
      getURL: (path) => `chrome-extension://e229-test/${path}`,
      sendMessage: vi.fn(async () => ({ ok: true })),
      onMessage: { addListener: (listener) => messages.push(listener) }
    }
  });

  vi.stubGlobal("fetch", vi.fn(async (url, options = {}) => {
    if (String(url).includes("/v1/commands?wait=")) return new Promise(() => {});
    if (!String(url).endsWith("/v1/sync")) throw new Error(`Unexpected request ${url}`);
    const token = options.headers.authorization.replace("Bearer ", "");
    if (token === TOKEN_B) return { ok: true, json: async () => ({ status: {} }) };
    return new Promise((resolve, reject) => {
      const request = {
        token, signal: options.signal, aborted: false,
        release() {
          if (!this.aborted) resolve({ ok: true, json: async () => ({ status: {} }) });
        }
      };
      options.signal?.addEventListener("abort", () => {
        request.aborted = true;
        const error = new Error("Request aborted");
        error.name = "AbortError";
        reject(error);
      }, { once: true });
      requests.push(request);
    });
  }));

  function send(type, extra = {}) {
    return new Promise((resolve, reject) => {
      const sender = { id: "e229-test", url: "chrome-extension://e229-test/dashboard.html" };
      if (!messages.some((listener) => listener({ type, ...extra }, sender, resolve))) {
        reject(new Error(`Unhandled ${type}`));
      }
    });
  }

  function externalConfig(next) {
    const previous = stored[CONFIG];
    if (next) stored[CONFIG] = next;
    else delete stored[CONFIG];
    for (const listener of changes) {
      listener({ [CONFIG]: { oldValue: previous, newValue: next } }, "local");
    }
  }

  return { stored, requests, send, externalConfig };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

it("local token rotation aborts an in-flight evidence export and rejects its stale success", async () => {
  vi.resetModules();
  const h = harness();
  await import("../agent/background-mcp-bridge.js");
  const old = h.send("mcp:configure", { token: TOKEN_A });
  await until(() => h.requests.length === 1);
  expect((await h.send("mcp:configure", { token: TOKEN_B })).connected).toBe(true);
  await sleep(30);
  const wasAborted = h.requests[0].aborted;
  h.requests[0].release();
  expect(wasAborted).toBe(true);
  expect((await old).connected).toBe(false);
  expect(h.stored[CONFIG].token).toBe(TOKEN_B);
});

it("local disconnect aborts an in-flight export without claiming success", async () => {
  vi.resetModules();
  const h = harness();
  await import("../agent/background-mcp-bridge.js");
  const old = h.send("mcp:configure", { token: TOKEN_A });
  await until(() => h.requests.length === 1);
  expect((await h.send("mcp:disconnect")).connected).toBe(false);
  await sleep(30);
  const wasAborted = h.requests[0].aborted;
  h.requests[0].release();
  expect(wasAborted).toBe(true);
  expect((await old).connected).toBe(false);
  expect(h.stored[CONFIG]).toBeUndefined();
});

it("external pairing rotation emits a storage event that aborts the old request", async () => {
  vi.resetModules();
  const h = harness();
  await import("../agent/background-mcp-bridge.js");
  const old = h.send("mcp:configure", { token: TOKEN_A });
  await until(() => h.requests.length === 1);
  h.externalConfig({ enabled: true, token: TOKEN_B });
  await sleep(30);
  const wasAborted = h.requests[0].aborted;
  h.requests[0].release();
  expect(wasAborted).toBe(true);
  expect((await old).connected).toBe(false);
});

it("metadata-only storage updates do not abort a valid in-flight sync", async () => {
  vi.resetModules();
  const h = harness();
  await import("../agent/background-mcp-bridge.js");
  const active = h.send("mcp:configure", { token: TOKEN_A });
  await until(() => h.requests.length === 1);
  h.externalConfig({ ...h.stored[CONFIG], lastError: "temporary" });
  await sleep(20);
  expect(h.requests[0].aborted).toBe(false);
  h.requests[0].release();
  expect((await active).connected).toBe(true);
});
