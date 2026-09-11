#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { claudeInstallCommand, codexInstallCommand, configFor, cursorConfig } from "./config.mjs";
import {
  bridgePaths,
  createBridgeStore,
  ensureBridgeToken,
  readPersistedState,
  startLocalBridge
} from "./state-store.mjs";

function asText(value) {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}

function extensions(snapshot) {
  return Array.isArray(snapshot?.inventory?.extensions) ? snapshot.inventory.extensions : [];
}

function compactExtension(item, snapshot) {
  const preference = snapshot?.preferences?.[item.id] ?? null;
  const trial = snapshot?.trials?.[item.id] ?? null;
  const unreadAlert = (snapshot?.alerts ?? []).some((alert) => alert.extensionId === item.id && !alert.seen);
  return {
    id: item.id,
    name: item.name,
    version: item.version,
    enabled: item.enabled,
    installType: item.installType,
    mayDisable: item.mayDisable,
    permissions: item.permissions ?? [],
    hostPermissions: item.hostPermissions ?? [],
    verdict: preference?.verdict ?? null,
    trial: trial ? { active: Boolean(trial.active), outcome: trial.outcome ?? null, dependencyContext: trial.dependencyContext ?? null } : null,
    unreviewedAccessChange: unreadAlert
  };
}

function attentionScore(item, snapshot) {
  const compact = compactExtension(item, snapshot);
  const broad = compact.hostPermissions.some((value) => value === "<all_urls>" || value.includes("*://*/*"));
  let score = 0;
  if (compact.unreviewedAccessChange) score += 100;
  if (compact.verdict === "unnecessary") score += 80;
  if (compact.trial?.outcome === "survived-trial") score += 70;
  if (!compact.enabled) score += 35;
  if (broad) score += 30;
  if (compact.verdict === "essential") score -= 40;
  if (compact.trial?.outcome === "needed") score -= 35;
  return score;
}

async function handleCliMode() {
  const args = process.argv.slice(2);
  if (args.includes("--print-token")) {
    process.stdout.write(`${await ensureBridgeToken()}\n`);
    return true;
  }

  const configIndex = args.indexOf("--config");
  if (configIndex >= 0) {
    const target = args[configIndex + 1];
    const config = configFor(target);
    process.stdout.write(config.type === "json" ? `${JSON.stringify(config.value, null, 2)}\n` : `${config.value}\n`);
    return true;
  }

  if (args.includes("--setup")) {
    const token = await ensureBridgeToken();
    process.stdout.write([
      "Xtension MCP local setup",
      "",
      `Pairing token: ${token}`,
      "Paste this once into Xtension Dashboard → MCP Bridge.",
      "",
      "Codex:",
      codexInstallCommand(),
      "",
      "Claude Code:",
      claudeInstallCommand(),
      "",
      "Cursor (~/.cursor/mcp.json):",
      JSON.stringify(cursorConfig(), null, 2),
      "",
      "Generic stdio command:",
      "npx -y @xtension/mcp"
    ].join("\n") + "\n");
    return true;
  }

  if (args.includes("--help") || args.includes("-h")) {
    process.stdout.write([
      "Xtension MCP",
      "",
      "  xtension-mcp                 Start the stdio MCP server + local Chrome bridge",
      "  xtension-mcp --setup         Print pairing token and client setup snippets",
      "  xtension-mcp --print-token   Print only the persistent local pairing token",
      "  xtension-mcp --config codex  Print Codex install command",
      "  xtension-mcp --config claude Print Claude Code install command",
      "  xtension-mcp --config cursor Print Cursor mcp.json fragment",
      "  xtension-mcp --config generic Print generic stdio config"
    ].join("\n") + "\n");
    return true;
  }

  return false;
}

async function main() {
  if (await handleCliMode()) return;

  const token = await ensureBridgeToken();
  const initialState = await readPersistedState();
  const store = createBridgeStore({ token, initialState });
  const { port } = startLocalBridge(store);

  console.error(`Xtension MCP bridge listening on 127.0.0.1:${port}`);
  console.error(`Bridge token stored at ${bridgePaths.tokenPath}`);

  const server = new McpServer({ name: "xtension", version: "0.1.0" });

  server.registerTool("xtension_status", {
    description: "Check whether the local Xtension Chrome agent has synced with this MCP server.",
    inputSchema: z.object({}),
    annotations: { readOnlyHint: true }
  }, async () => asText(store.compactStatus()));

  server.registerTool("xtension_inventory", {
    description: "List installed Chrome extensions from Xtension's local inventory. Returns compact facts, not raw browsing history.",
    inputSchema: z.object({ limit: z.number().int().min(1).max(100).optional().default(30) }),
    annotations: { readOnlyHint: true }
  }, async ({ limit }) => {
    const snapshot = store.state.snapshot;
    return asText({
      observedAt: snapshot?.inventory?.observedAt ?? null,
      total: extensions(snapshot).length,
      extensions: extensions(snapshot).slice(0, limit).map((item) => compactExtension(item, snapshot))
    });
  });

  server.registerTool("xtension_get_extension", {
    description: "Get detailed local evidence for one installed extension by extension ID.",
    inputSchema: z.object({ extensionId: z.string().min(1) }),
    annotations: { readOnlyHint: true }
  }, async ({ extensionId }) => {
    const snapshot = store.state.snapshot;
    const item = extensions(snapshot).find((extension) => extension.id === extensionId);
    if (!item) return asText({ found: false, extensionId });
    return asText({
      found: true,
      extension: item,
      preference: snapshot?.preferences?.[extensionId] ?? null,
      trial: snapshot?.trials?.[extensionId] ?? null,
      alerts: (snapshot?.alerts ?? []).filter((alert) => alert.extensionId === extensionId).slice(0, 20),
      timeline: (snapshot?.timeline ?? []).filter((event) => event.extensionId === extensionId).slice(0, 30),
      versionHistory: snapshot?.versionHistory?.[extensionId] ?? []
    });
  });

  server.registerTool("xtension_attention_queue", {
    description: "Return extensions most worth reviewing based on local decisions, disable-trial outcomes, access changes, enabled state, and broad host access. This is an evidence queue, not fabricated usage telemetry.",
    inputSchema: z.object({ limit: z.number().int().min(1).max(25).optional().default(8) }),
    annotations: { readOnlyHint: true }
  }, async ({ limit }) => {
    const snapshot = store.state.snapshot;
    const ranked = extensions(snapshot)
      .map((item) => ({ score: attentionScore(item, snapshot), ...compactExtension(item, snapshot) }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
      .slice(0, limit);
    return asText({ count: ranked.length, items: ranked });
  });

  server.registerTool("xtension_changes", {
    description: "Read recent locally observed extension lifecycle, version, permission, trial, and cleanup changes.",
    inputSchema: z.object({ limit: z.number().int().min(1).max(100).optional().default(20) }),
    annotations: { readOnlyHint: true }
  }, async ({ limit }) => asText({ events: (store.state.snapshot?.timeline ?? []).slice(0, limit) }));

  server.registerTool("xtension_set_verdict", {
    description: "Set the user's explicit local verdict for an extension: essential, optional, or unnecessary.",
    inputSchema: z.object({
      extensionId: z.string().min(1),
      verdict: z.enum(["essential", "optional", "unnecessary"])
    }),
    annotations: { readOnlyHint: false, destructiveHint: false }
  }, async (input) => asText(await store.enqueueCommand("set-verdict", input)));

  server.registerTool("xtension_start_trial", {
    description: "Start a reversible disable trial for an extension. Xtension never uninstalls it automatically.",
    inputSchema: z.object({ extensionId: z.string().min(1), days: z.number().int().min(1).max(30).optional().default(7) }),
    annotations: { readOnlyHint: false, destructiveHint: false }
  }, async (input) => asText(await store.enqueueCommand("start-trial", input)));

  server.registerTool("xtension_restore_extension", {
    description: "Re-enable an extension, including one disabled during an Xtension trial.",
    inputSchema: z.object({ extensionId: z.string().min(1) }),
    annotations: { readOnlyHint: false, destructiveHint: false }
  }, async (input) => asText(await store.enqueueCommand("restore-extension", input)));

  server.registerTool("xtension_uninstall_extension", {
    description: "Ask Chrome to uninstall an extension. Chrome's own confirmation UI remains in the loop.",
    inputSchema: z.object({ extensionId: z.string().min(1) }),
    annotations: { readOnlyHint: false, destructiveHint: true }
  }, async (input) => asText(await store.enqueueCommand("uninstall-extension", input)));

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
