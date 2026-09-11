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

See [`docs/PRODUCT_ARCHITECTURE.md`](docs/PRODUCT_ARCHITECTURE.md) for the detailed product model.

## What works now

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

## Next product layer

The next major subsystem is the **Xtension Agent**:

- inventory all installed extensions, including disabled ones
- capture enabled state, install type, permissions and host permissions
- subscribe to install/uninstall/enable/disable changes
- create a dashboard over the user's entire extension set
- rank extensions by relevance evidence and exposure
- offer **Trial Disable** instead of pretending to know exact usage
- optionally request browser-history access at runtime for local-only site-overlap relevance signals

Chrome does not expose a trustworthy public counter for "how many times extension X was used." Xtension will keep actual observations, inferences, and recommendations separate rather than inventing fake precision.

## Safety and privacy model

- User input is reduced to a validated Chrome extension ID (`[a-p]{32}`).
- The analysis server never fetches an arbitrary user-provided URL.
- Package size and file-count limits are enforced before analysis.
- Extension JavaScript is inspected as text and is never executed.
- Reports distinguish required permissions, optional permissions, static references, and proven behavior.
- Raw browsing history should remain local to the browser agent.
- Optional workflow-analysis permissions are requested only when the user enables that feature.
- Xtension never silently disables or uninstalls another extension.

## Stack

Next.js + TypeScript + JSZip, with a Manifest V3 Chrome agent planned as the local browser bridge.

## Run

```bash
npm install
npm run dev
```

Then open `http://localhost:3000`.

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
5. **Xtension Agent** — inventory the user's installed extensions and state.
6. **Dashboard** — manage the whole extension portfolio, not one extension at a time.
7. **Trial Disable** — measure workflow dependency safely.
8. **Relevance engine** — evidence-based cleanup recommendations, with optional local-only site-overlap signals.
9. **Permission diffs** — persist versions and show what access changed.
10. **Indexed extension corpus / org monitoring** — ecosystem intelligence and enterprise controls.

## Non-goals

Xtension does not label an extension as malware from permissions alone, claim that a capability is actively used, silently modify another extension, or pretend Chrome exposes per-extension usage telemetry when it does not.

## License

MIT
