# Xtension

**See what a browser extension can technically access before you trust it.**

Xtension is an open-source browser-extension transparency scanner. Paste a Chrome Web Store URL and Xtension fetches the published CRX from Chrome's update service, extracts the package, reads `manifest.json`, and translates permissions and code references into plain-English capabilities.

Xtension reports **capabilities, not accusations**. A permission or API reference shows what an extension may be able to do; it does not prove that the extension collects data or behaves maliciously.

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

## Safety model

- User input is reduced to a validated Chrome extension ID (`[a-p]{32}`).
- The server never fetches an arbitrary user-provided URL.
- Package size and file-count limits are enforced before analysis.
- Extension JavaScript is inspected as text and is never executed.
- Reports distinguish required permissions, optional permissions, static references, and proven behavior.

## Stack

Next.js + TypeScript + JSZip.

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

Once deployed, extension developers can link a badge to their public Xtension report from a README or docs page. The badge communicates the current capability surface, not a malware verdict.

## Distribution architecture

One scan should create several reusable assets:

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

The long-term compounding asset is not the UI. It is permission/capability history across extension versions.

## Product direction

1. **Scanner** — implemented.
2. **Public extension pages** — implemented as live reports.
3. **Machine-readable report API** — implemented.
4. **Embeddable capability badge** — implemented.
5. **Permission diffs** — persist versions and show what access changed.
6. **Share cards** — generate native social images from report facts.
7. **Indexed extension corpus** — crawl/store selected public extensions and build ecosystem statistics.
8. **Dataset/API** — permission history and ecosystem-level research endpoints.
9. **Org monitoring** — alert teams when approved extensions gain new capabilities.

## Non-goals

Xtension does not label an extension as malware from permissions alone, claim that a capability is actively used, or execute extension code during static analysis.

## License

MIT
