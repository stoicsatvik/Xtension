const MCP_CONFIG_KEY = "xtension.mcp.v1";
const MCP_ORIGIN = "http://127.0.0.1/*";

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function ensureContainer() {
  let container = document.querySelector("#mcpBridge");
  if (container) return container;
  container = document.createElement("section");
  container.id = "mcpBridge";
  container.className = "mcp-bridge";
  document.querySelector("#cleanupImpact")?.insertAdjacentElement("afterend", container);
  return container;
}

async function worker(message) {
  const response = await chrome.runtime.sendMessage(message);
  if (response?.error) throw new Error(response.error);
  return response;
}

function formatTime(value) {
  if (!value) return "never";
  return new Date(value).toLocaleString();
}

async function render() {
  const container = ensureContainer();
  const status = await worker({ type: "mcp:status" });

  if (!status.configured) {
    container.innerHTML = `
      <div>
        <div class="eyebrow">MCP BRIDGE</div>
        <h2>Connect Xtension to your AI tools</h2>
        <p>Run <code>npx @xtension/mcp --print-token</code>, paste the local pairing token once, then Codex, Claude, Cursor, and other MCP clients can inspect this browser evidence.</p>
      </div>
      <div class="mcp-connect">
        <input id="mcpTokenInput" type="password" autocomplete="off" placeholder="Local bridge token" />
        <button id="mcpConnectButton">Connect MCP</button>
        <small>Only Xtension's derived local evidence is synced to 127.0.0.1. Raw browsing history is not sent.</small>
      </div>`;

    document.querySelector("#mcpConnectButton").addEventListener("click", async () => {
      const button = document.querySelector("#mcpConnectButton");
      const token = document.querySelector("#mcpTokenInput").value.trim();
      try {
        button.disabled = true;
        if (token.length < 32) throw new Error("Paste the pairing token printed by @xtension/mcp.");
        const granted = await chrome.permissions.request({ origins: [MCP_ORIGIN] });
        if (!granted) throw new Error("Localhost permission is required only for the MCP bridge.");
        await worker({ type: "mcp:configure", token });
        await render();
      } catch (error) {
        button.disabled = false;
        container.querySelector("small").textContent = error?.message || "Could not connect to the local MCP bridge.";
        container.classList.add("error");
      }
    });
    return;
  }

  container.classList.remove("error");
  container.innerHTML = `
    <div>
      <div class="eyebrow">MCP BRIDGE</div>
      <h2>AI tools connected locally</h2>
      <p>Last evidence sync: <strong>${escapeHtml(formatTime(status.lastSyncAt))}</strong>${status.lastError ? ` · <span class="mcp-error">${escapeHtml(status.lastError)}</span>` : ""}</p>
    </div>
    <div class="mcp-actions">
      <button id="mcpSyncButton" class="secondary">Sync now</button>
      <button id="mcpDisconnectButton" class="secondary">Disconnect</button>
    </div>`;

  document.querySelector("#mcpSyncButton").addEventListener("click", async () => {
    await worker({ type: "mcp:sync" });
    await render();
  });
  document.querySelector("#mcpDisconnectButton").addEventListener("click", async () => {
    await worker({ type: "mcp:disconnect" });
    await chrome.permissions.remove({ origins: [MCP_ORIGIN] });
    await render();
  });
}

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "local" && changes[MCP_CONFIG_KEY]) void render();
});

await render();
