import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { assertChromeExtensionId, isValidChromeExtensionId, shouldRestartMcpLoop } from "../agent/mcp-bridge-policy.js";

const valid = "abcdefghijklmnopabcdefghijklmnop";
const invalid = [
  null, undefined, {}, [], 0, "", "abc", "__proto__", "constructor", "toString",
  valid.toUpperCase(), valid + "a", valid.slice(1), "a".repeat(31) + "q",
  "a".repeat(31) + "\n", "a".repeat(31) + "é", "a".repeat(32) + "\n"
];

describe("E475 MCP Chrome extension identity boundary", () => {
  it("accepts the full 32-character a-p alphabet", () => {
    expect(isValidChromeExtensionId(valid)).toBe(true);
    expect(assertChromeExtensionId(valid)).toBe(valid);
    expect(isValidChromeExtensionId("a".repeat(32))).toBe(true);
    expect(isValidChromeExtensionId("p".repeat(32))).toBe(true);
  });

  it.each(invalid)("rejects malformed or prototype-like identity %s", (id) => {
    expect(isValidChromeExtensionId(id)).toBe(false);
    expect(() => assertChromeExtensionId(id)).toThrow("Invalid Chrome extension ID.");
  });

  it("prevents the original object-prototype assignment counterexample", () => {
    const oldPreferences = {};
    oldPreferences["__proto__"] = { verdict: "unnecessary" };
    expect(Object.getPrototypeOf(oldPreferences).verdict).toBe("unnecessary");

    const preferences = {};
    expect(() => {
      preferences[assertChromeExtensionId("__proto__")] = { verdict: "unnecessary" };
    }).toThrow("Invalid Chrome extension ID.");
    expect(Object.getPrototypeOf(preferences)).toBe(Object.prototype);
  });

  it("validates every MCP extension tool input schema", () => {
    const server = readFileSync(new URL("../mcp/src/server.mjs", import.meta.url), "utf8");
    expect(server.split('extensionId: z.string().regex(/^[a-p]{32}$/, "Invalid Chrome extension ID.")').length - 1).toBe(5);
    expect(server).not.toContain("extensionId: z.string().min(1)");
  });

  it("fences browser commands before dispatching effects", () => {
    const bridge = readFileSync(new URL("../agent/background-mcp-bridge.js", import.meta.url), "utf8");
    const section = bridge.split("async function executeCommand(command) {")[1]?.split("switch (command?.type) {")[0];
    expect(section).toContain("assertChromeExtensionId(payload.extensionId)");
    expect(section).toContain('"uninstall-extension"');
  });

  it("retains status-only poll-loop non-restart behavior", () => {
    const config = { enabled: true, token: "token", lastSyncAt: 1 };
    expect(shouldRestartMcpLoop(config, { ...config, lastSyncAt: 2 })).toBe(false);
    expect(shouldRestartMcpLoop(config, { ...config, token: "changed" })).toBe(true);
  });
});
