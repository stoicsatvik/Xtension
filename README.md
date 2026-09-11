# Xtension

**A control plane for the browser extensions you already have.**

Xtension is not primarily another extension scanner. The installed Chrome component is a local agent/bridge that inventories the extensions already in your browser, while the Xtension dashboard explains what each one can access, whether it is enabled, what changed over time, how relevant it appears to your workflow, and what action you should take.

The goal is simple:

> Reduce extension clutter and attack surface without breaking useful workflows.

Xtension reports **capabilities, not accusations**. A permission or API reference shows what an extension may be able to do; it does not prove that the extension collects data or behaves maliciously.

## Product architecture

```text
Chrome
  |
  | installed-extension inventory
  | enable/disable/install/uninstall events
  | optional local workflow signals
  v
Xtension Agent
  |
  +--> local inventory + relevance evidence
  +--> trial-disable / re-enable / uninstall actions
  |
  +--> Xtension analysis backend
          |
          +--> CRX manifest analysis
          +--> static code signals
          +--> permission/version history
          +--> capability diffs
          v
      Dashboard
```

See [`docs/PRODUCT_ARCHITECTURE.md`](docs/PRODUCT_ARCHITECTURE.md) for the detailed product model and [`agent/README.md`](agent/README.md) for the installed-agent prototype.

## What works now

### Static/public analysis

- Paste a Chrome Web Store URL or extension ID.
- Fetch the public CRX only from Google's Chrome update endpoint.
- Parse CRX2/CRX3 and extract `manifest.json`.
- Keep required and optional permissions separate.
- Explain requested API permissions and host access.
- Detect content scripts and broad host patterns such as `<all_urls>`.
- Statically scan JavaScript for notable browser APIs and external network endpoints.
- Publish a permanent report route at `/extension/<id>`.
- Expose machine-readable JSON at `/api/report/<id>`.
- Expose an embeddable SVG capability badge at `/api/badge/<id>`.

### Xtension Agent prototype

- Inventory installed extensions, including disabled ones.
- Capture enabled state, disabled reason, install type, version, permissions, and host permissions.
- Refresh inventory on install/uninstall/enable/disable events.
- Render a local dashboard over the user's complete extension portfolio.
- Separate exposure from relevance instead of collapsing them into a fake risk score.
- Offer **Trial Disable for 7 days** as a counterfactual workflow test.
- Let the user re-enable or uninstall extensions through explicit Chrome-confirmed actions.
- Optionally request browser-history access at runtime for local-only workflow relevance evidence.
- Compare recent browsing pages against declared host permissions without storing or uploading raw history.

Chrome does not expose a trustworthy public counter for "how many times extension X was used." Xtension keeps actual observations, contextual inferences, and recommendations separate rather than inventing fake precision.

## Safety and privacy model

- User input is reduced to a validated Chrome extension ID (`[a-p]{32}`).
- The analysis server never fetches an arbitrary user-provided URL.
- Package size and file-count limits are enforced before analysis.
- Extension JavaScript is inspected as text and is never executed.
- Reports distinguish required permissions, optional permissions, static references, and proven behavior.
- Raw browsing history remains local to the browser agent.
- Optional workflow-analysis permissions are requested only when the user enables that feature.
- Xtension never silently disables or uninstalls another extension.

## Stack

Next.js + TypeScript + JSZip for public analysis, plus a Manifest V3 Chrome agent for local browser inventory and controls.

## Run the web app

```bash
npm install
npm run dev
```

Then open `http://localhost:3000`.

## Load the Agent prototype

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Choose **Load unpacked**.
4. Select the repository's `agent/` directory.
5. Accept the management permission warning.
6. Click the Xtension toolbar action to open the local dashboard.

Workflow relevance remains off until the user explicitly grants the optional history permission from the dashboard.

## Public surfaces

```text
/                         interactive scanner
/extension/<id>           human-readable report
/api/report/<id>          JSON report
/api/badge/<id>           embeddable SVG badge
```

## Distribution architecture

One extension analysis should create several reusable assets:

```text
published extension package
          ↓
       analysis
          ↓
  ┌───────┼────────┐
  ↓       ↓        ↓
report   JSON     badge
  ↓       ↓        ↓
search  tools   README/docs
```

The compounding asset is not the UI. It is extension inventory intelligence plus permission/capability history across versions.

## Product direction

1. **Static scanner** — implemented.
2. **Public extension pages** — implemented as live reports.
3. **Machine-readable report API** — implemented.
4. **Embeddable capability badge** — implemented.
5. **Xtension Agent** — prototype implemented.
6. **Portfolio dashboard** — prototype implemented.
7. **Trial Disable** — prototype implemented.
8. **Local relevance evidence** — initial site-overlap prototype implemented.
9. **Connect Agent ↔ analyzer** — enrich every installed extension with package-level analysis.
10. **Permission diffs** — persist versions and show what access changed.
11. **Redundancy analysis** — detect overlapping tools without overclaiming equivalence.
12. **Indexed extension corpus / org monitoring** — ecosystem intelligence and enterprise controls.

## Non-goals

Xtension does not label an extension as malware from permissions alone, claim that a capability is actively used, silently modify another extension, upload browsing history by default, or pretend Chrome exposes per-extension usage telemetry when it does not.

## License

MIT
