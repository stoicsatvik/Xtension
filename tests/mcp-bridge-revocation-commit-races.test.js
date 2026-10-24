import { afterEach, expect, it, vi } from "vitest";

const CONFIG = "xtension.mcp.v1";
const PREFS = "xtension.preferences.v1";
const APPROVALS = "xtension.mcp.approvals.v1";
const EXTENSION = "a".repeat(32);
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function until(predicate) {
  const deadline = Date.now() + 2000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("Controlled race barrier was not reached");
    await delay(5);
  }
}

function harness({ pauseApprovalRead = false, pausePreferenceCommit = false } = {}) {
  const tokenA = "a".repeat(64), tokenB = "b".repeat(64);
  const stored = { [CONFIG]: { enabled: true, token: tokenA } };
  const listeners = [], polls = new Map(), approvalReads = [], preferenceCommits = [];
  const acknowledgements = [];
  let preferenceWrites = 0, approvalWrites = 0;

  function changed(key, oldValue, newValue) {
    for (const listener of listeners) listener({ [key]: { oldValue, newValue } }, "local");
  }
  async function set(updates) {
    for (const [key, value] of Object.entries(updates)) {
      if (key === PREFS && pausePreferenceCommit) {
        await new Promise((resolve) => preferenceCommits.push(resolve));
      }
      const previous = stored[key];
      stored[key] = value;
      if (key === PREFS) preferenceWrites++;
      if (key === APPROVALS) approvalWrites++;
      changed(key, previous, value);
    }
  }
  vi.stubGlobal("chrome", {
    storage: {
      local: {
        get: async (keys) => {
          if (keys === APPROVALS && pauseApprovalRead) {
            return new Promise((resolve) => approvalReads.push(() =>
              resolve({ [APPROVALS]: stored[APPROVALS] })));
          }
          const names = Array.isArray(keys) ? keys : [keys];
          return Object.fromEntries(names.map((key) => [key, stored[key]]));
        },
        set,
        remove: async (keys) => {
          for (const key of (Array.isArray(keys) ? keys : [keys])) {
            const previous = stored[key];
            delete stored[key];
            changed(key, previous, undefined);
          }
        }
      },
      onChanged: { addListener: (listener) => listeners.push(listener) }
    },
    runtime: {
      id: "e226-test",
      getURL: (path) => `chrome-extension://e226-test/${path}`,
      sendMessage: vi.fn(async () => ({ ok: true })),
      onMessage: { addListener: () => {} }
    }
  });
  vi.stubGlobal("fetch", vi.fn(async (url, options = {}) => {
    const path = String(url);
    const token = String(options.headers?.authorization ?? "").replace(/^Bearer /, "");
    if (path.endsWith("/v1/sync")) return {
      ok: true, json: async () => ({ status: { lastSyncAt: 1 } })
    };
    if (path.includes("/v1/commands/") && path.endsWith("/result")) {
      acknowledgements.push({ path, token });
      return { ok: true, json: async () => ({ ok: true }) };
    }
    if (path.includes("/v1/commands?wait=")) {
      return new Promise((resolve) => {
        if (!polls.has(token)) polls.set(token, []);
        polls.get(token).push(resolve);
      });
    }
    throw new Error(`Unexpected request ${path}`);
  }));

  return {
    tokenA, tokenB, stored, acknowledgements,
    get preferenceWrites() { return preferenceWrites; },
    get approvalWrites() { return approvalWrites; },
    get approvalReadsPending() { return approvalReads.length; },
    get preferenceCommitsPending() { return preferenceCommits.length; },
    async respond(command) {
      await until(() => (polls.get(tokenA)?.length ?? 0) > 0);
      polls.get(tokenA).shift()({ ok: true, json: async () => ({ commands: [command] }) });
    },
    releaseApprovalRead() { approvalReads.shift()(); },
    releasePreferenceCommit() { preferenceCommits.shift()(); },
    async revoke(kind) {
      if (kind === "rotate") {
        await set({ [CONFIG]: { enabled: true, token: tokenB } });
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
  "does not resurrect a pending approval after %s during its async read",
  async (kind) => {
    vi.resetModules();
    const h = harness({ pauseApprovalRead: true });
    await import("../agent/background-mcp-bridge.js");
    await h.respond({ id: `approval-${kind}`, type: "uninstall-extension",
      payload: { extensionId: EXTENSION } });
    await until(() => h.approvalReadsPending === 1);
    await h.revoke(kind);
    h.releaseApprovalRead();
    await delay(75);
    expect(h.approvalWrites).toBe(0);
    expect(h.stored[APPROVALS]).toBeUndefined();
    expect(h.acknowledgements).toHaveLength(0);
  }
);

it("still records pending approval for an authorized destructive command", async () => {
  vi.resetModules();
  const h = harness();
  await import("../agent/background-mcp-bridge.js");
  await h.respond({ id: "approval-current", type: "uninstall-extension",
    payload: { extensionId: EXTENSION } });
  await until(() => h.approvalWrites === 1);
  expect(h.stored[APPROVALS]["approval-current"].status).toBe("pending");
  expect(h.acknowledgements).toHaveLength(0);
});

// A documented *expected failure*, not a claim that E226 fixed atomicity.
// Chrome's storage API has no transaction between checking pairing and
// committing a previously started storage.local.set. This test is deliberately
// marked fails until a cross-context transactional protocol exists.
it.fails("atomic revocation: a suspended preference commit must not land after token rotation", async () => {
  vi.resetModules();
  const h = harness({ pausePreferenceCommit: true });
  await import("../agent/background-mcp-bridge.js");
  await h.respond({ id: "commit-race", type: "set-verdict",
    payload: { extensionId: EXTENSION, verdict: "unnecessary" } });
  await until(() => h.preferenceCommitsPending === 1);
  await h.revoke("rotate");
  h.releasePreferenceCommit();
  await delay(75);
  expect(h.preferenceWrites).toBe(0);
  expect(h.stored[PREFS]).toBeUndefined();
  expect(h.acknowledgements).toHaveLength(0);
});
