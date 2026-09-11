import assert from "node:assert/strict";
import test from "node:test";
import { claudeInstallCommand, codexInstallCommand, configFor, cursorConfig } from "../src/config.mjs";

test("Codex setup uses local stdio npx server", () => {
  assert.equal(codexInstallCommand(), "codex mcp add xtension -- npx -y @xtension/mcp");
});

test("Claude setup uses stdio and user scope", () => {
  assert.match(claudeInstallCommand(), /^claude mcp add --transport stdio --scope user xtension -- npx -y @xtension\/mcp$/);
});

test("Cursor setup emits standard mcpServers config", () => {
  assert.deepEqual(cursorConfig(), {
    mcpServers: {
      xtension: {
        command: "npx",
        args: ["-y", "@xtension/mcp"]
      }
    }
  });
  assert.equal(configFor("cursor").type, "json");
});
