import { describe, expect, it } from "vitest";
import { appendVersionHistory, materiallyChanged, versionObservation } from "../agent/version-history-policy.js";

const extension = (overrides = {}) => ({
  id: "one",
  version: "1.0.0",
  enabled: true,
  permissions: ["storage"],
  hostPermissions: ["https://example.com/*"],
  ...overrides
});

describe("local version history", () => {
  it("records the first locally observed package state", () => {
    const next = appendVersionHistory({}, null, {
      observedAt: 100,
      extensions: [extension()]
    });
    expect(next.one).toHaveLength(1);
    expect(next.one[0]).toMatchObject({ version: "1.0.0", observedAt: 100 });
  });

  it("does not append when only enabled state changes", () => {
    const before = { observedAt: 100, extensions: [extension({ enabled: true })] };
    const after = { observedAt: 200, extensions: [extension({ enabled: false })] };
    const history = { one: [versionObservation(before.extensions[0], 100)] };
    expect(appendVersionHistory(history, before, after)).toEqual(history);
  });

  it("records version, permission, and host-scope changes", () => {
    const before = { observedAt: 100, extensions: [extension()] };
    const after = {
      observedAt: 200,
      extensions: [extension({
        version: "2.0.0",
        permissions: ["storage", "scripting"],
        hostPermissions: ["<all_urls>"]
      })]
    };
    const history = { one: [versionObservation(before.extensions[0], 100)] };
    const next = appendVersionHistory(history, before, after);
    expect(next.one).toHaveLength(2);
    expect(next.one[1]).toMatchObject({
      version: "2.0.0",
      permissions: ["scripting", "storage"],
      hostPermissions: ["<all_urls>"]
    });
  });

  it("keeps history bounded", () => {
    const history = { one: [] };
    for (let i = 0; i < 30; i += 1) {
      history.one.push(versionObservation(extension({ version: `${i}.0.0` }), i));
    }
    const before = { observedAt: 30, extensions: [extension({ version: "29.0.0" })] };
    const after = { observedAt: 31, extensions: [extension({ version: "30.0.0" })] };
    const next = appendVersionHistory(history, before, after, 25);
    expect(next.one).toHaveLength(25);
    expect(next.one.at(-1).version).toBe("30.0.0");
  });

  it("ignores order-only changes in permissions", () => {
    expect(materiallyChanged(
      extension({ permissions: ["storage", "tabs"] }),
      extension({ permissions: ["tabs", "storage"] })
    )).toBe(false);
  });
});
