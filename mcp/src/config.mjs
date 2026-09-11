export const XTENSION_MCP_COMMAND = Object.freeze({
  command: "npx",
  args: ["-y", "@xtension/mcp"]
});

export function codexInstallCommand() {
  return "codex mcp add xtension -- npx -y @xtension/mcp";
}

export function claudeInstallCommand() {
  return "claude mcp add --transport stdio --scope user xtension -- npx -y @xtension/mcp";
}

export function cursorConfig() {
  return {
    mcpServers: {
      xtension: {
        command: XTENSION_MCP_COMMAND.command,
        args: [...XTENSION_MCP_COMMAND.args]
      }
    }
  };
}

export function genericStdioConfig() {
  return {
    name: "xtension",
    transport: "stdio",
    command: XTENSION_MCP_COMMAND.command,
    args: [...XTENSION_MCP_COMMAND.args]
  };
}

export function configFor(target) {
  switch (target) {
    case "codex": return { type: "command", value: codexInstallCommand() };
    case "claude": return { type: "command", value: claudeInstallCommand() };
    case "cursor": return { type: "json", value: cursorConfig() };
    case "generic": return { type: "json", value: genericStdioConfig() };
    default: throw new Error(`Unknown MCP client: ${target}`);
  }
}
