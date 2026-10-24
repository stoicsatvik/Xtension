import { afterEach, expect, it, vi } from "vitest";

const KEY = "xtension.mcp.v1";
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

it("a successful sync does not recursively restart the polling loop, but token rotation does", async () => {
  vi.resetModules();
  const listeners = [];
  const stored = { [KEY]: { enabled: true, token: "a".repeat(64) } };
  let syncRequests = 0;
  let configEvents = 0;

  vi.stubGlobal("chrome", {
    storage: {
      local: {
        get: async (keys) => {
          const names = Array.isArray(keys) ? keys : [keys];
          return Object.fromEntries(names.map((key) => [key, stored[key]]));
        },
        set: async (changes) => {
          const previous = { ...stored };
          Object.assign(stored, changes);
          if (Object.hasOwn(changes, KEY) && configEvents++ < 5) {
            // Asynchronous delivery models Chrome storage events and caps the
            // pre-fix runaway loop so the falsification terminates.
            setTimeout(() => {
              for (const listener of listeners) {
                listener({ [KEY]: { oldValue: previous[KEY], newValue: stored[KEY] } }, "local");
              }
            }, 1);
          }
        },
        remove: async (keys) => {
          for (const key of (Array.isArray(keys) ? keys : [keys])) delete stored[key];
        }
      },
      onChanged: { addListener: (listener) => listeners.push(listener) }
    },
    runtime: {
      id: "e222-test",
      getURL: (name) => `chrome-extension://e222-test/${name}`,
      onMessage: { addListener: () => {} }
    }
  });

  vi.stubGlobal("fetch", vi.fn(async (url) => {
    if (String(url).endsWith("/v1/sync")) {
      syncRequests++;
      return { ok: true, json: async () => ({ status: { lastSyncAt: 123 } }) };
    }
    if (String(url).includes("/v1/commands")) {
      // Keep each polling generation parked. Only sync-induced restarts
      // should cause additional /v1/sync requests in this experiment.
      return new Promise(() => {});
    }
    throw new Error(`Unexpected request: ${url}`);
  }));

  await import("../agent/background-mcp-bridge.js");
  await pause(100);
  expect(syncRequests).toBe(1);

  const oldValue = stored[KEY];
  const newValue = { ...oldValue, token: "b".repeat(64) };
  stored[KEY] = newValue;
  for (const listener of listeners) {
    listener({ [KEY]: { oldValue, newValue } }, "local");
  }
  await pause(50);
  expect(syncRequests).toBe(2);
});
