# Xtension

**See what a browser extension can technically access before you trust it.**

Xtension is an open-source browser-extension transparency scanner. Paste a Chrome Web Store URL and Xtension fetches the published CRX from Chrome's update service, extracts the package, reads `manifest.json`, and translates permissions and code references into plain-English capabilities.

Xtension reports **capabilities, not accusations**. A permission or API reference shows what an extension may be able to do; it does not prove that the extension collects data or behaves maliciously.

## MVP

- Paste a Chrome Web Store URL or extension ID.
- Fetch the public CRX only from Google's Chrome update endpoint.
- Parse CRX3 and extract `manifest.json`.
- Explain requested permissions and host access.
- Detect content scripts and broad host patterns such as `<all_urls>`.
- Statically scan JavaScript for notable browser APIs and external network endpoints.
- Return a human-readable capability report.

## Safety model

- User input is reduced to a validated Chrome extension ID (`[a-p]{32}`).
- The server never fetches an arbitrary user-provided URL.
- Package size and file-count limits are enforced before analysis.
- Reports distinguish declared permissions, observed static references, and proven behavior.

## Stack

Next.js + TypeScript + JSZip.

## Run

```bash
npm install
npm run dev
```

Then open `http://localhost:3000`.

## Product direction

1. **Scanner:** URL → capability report.
2. **Permission diffs:** track what access changed between versions.
3. **Public extension pages:** searchable reports for organic discovery.
4. **Share cards:** facts from reports become the distribution surface.
5. **Dataset/API:** permission history and ecosystem-level statistics.
6. **Org monitoring:** alert teams when installed extensions gain new capabilities.

## Non-goals

Xtension does not label an extension as malware from permissions alone, claim that a capability is actively used, or execute extension code during static analysis.

## License

MIT
