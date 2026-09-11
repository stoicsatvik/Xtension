# Xtension MCP

Local-first MCP access to your Chrome extension control plane.

The MCP process exposes Xtension's local extension inventory, decisions, access changes, disable-trial outcomes, and management actions to MCP clients such as Codex, Claude Code, Cursor, and other stdio-compatible hosts.

## Fast setup

Once this package is published:

```bash
npx -y @xtension/mcp --setup
```

That prints:

- the persistent local pairing token for the Xtension Chrome dashboard;
- the Codex install command;
- the Claude Code install command;
- the Cursor `mcp.json` fragment;
- the generic stdio command.

The MCP server itself is:

```bash
npx -y @xtension/mcp
```

### Codex

```bash
codex mcp add xtension -- npx -y @xtension/mcp
```

### Claude Code

```bash
claude mcp add --transport stdio --scope user xtension -- npx -y @xtension/mcp
```

### Cursor

Add this to `~/.cursor/mcp.json` for global availability:

```json
{
  "mcpServers": {
    "xtension": {
      "command": "npx",
      "args": ["-y", "@xtension/mcp"]
    }
  }
}
```

Any other MCP host that supports local stdio servers can run `npx -y @xtension/mcp`.

## Pair Chrome once

The MCP process creates a random 256-bit local token in `~/.xtension/bridge-token`.

Run:

```bash
npx -y @xtension/mcp --print-token
```

Open the Xtension dashboard, find **MCP Bridge**, paste the token, and choose **Connect MCP**. Chrome asks for access only to `http://127.0.0.1/*` for this optional feature.

The Chrome agent then syncs its derived Xtension evidence to a loopback-only bridge on `127.0.0.1:43128` and long-polls for MCP actions.

## Exposed tools

Read-only tools:

- `xtension_status`
- `xtension_inventory`
- `xtension_get_extension`
- `xtension_attention_queue`
- `xtension_changes`

Write tools:

- `xtension_set_verdict`
- `xtension_start_trial`
- `xtension_restore_extension`
- `xtension_uninstall_extension`

Uninstall remains destructive and Chrome's confirmation UI stays in the loop. Disable trials are reversible and never auto-uninstall an extension.

## Privacy boundary

The local bridge accepts only these top-level Xtension evidence fields: inventory, trials, preferences, alerts, timeline, version history, removed-extension records, and audit-session state.

Raw browsing history is intentionally not part of the bridge schema. Workflow relevance can still be computed inside the Chrome extension and represented as derived evidence without shipping raw history to the MCP process.

The bridge binds only to `127.0.0.1`, requires a random bearer token, applies a 2 MB request limit, and stores state under `~/.xtension` with restrictive file modes where supported.

## Development

From the repository root:

```bash
npm --prefix mcp install
npm --prefix mcp test
npm --prefix mcp run check
npm --prefix mcp start
```

For local development before npm publication, point the MCP host at the repository's `mcp/src/server.mjs` instead of `npx -y @xtension/mcp`.
