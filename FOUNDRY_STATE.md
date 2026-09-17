# Xtension Foundry State

## Mission
Local-first control plane for installed browser extensions: inventory, capability analysis, change history, workflow relevance evidence, and explicit user-controlled actions. Capabilities are evidence about possible access, not accusations of malicious behavior.

## Current architecture
- Next.js/TypeScript public CRX analysis and report surfaces.
- Manifest V3 local Chrome agent for installed-extension inventory and user-confirmed controls.
- Local-only optional workflow relevance evidence; raw browsing history is not uploaded by default.
- MCP bridge with retry-safe command leasing/result caching on the current main lineage.

## Evidence frontier
- Main head at branch creation: `1218d89288605f42d3443e1a3fb19bd92731c307`.
- CI workflow exists for pull requests and main, but no pull-request workflow run is attached to that exact main head through the connector.
- Existing CI runs unit tests, MV3 manifest/CSP checks, selected agent module syntax checks, MCP package tests/checks/pack verification, and the Next.js build.
- This branch adds `npm run typecheck` as an explicit CI contract because `package.json` defines it but the workflow previously did not execute it.

## Claim states
- Public/static analyzer architecture: SUPPORTED by repository implementation; current exact-head CI status NOT YET PROVEN in this Foundry run.
- Local agent architecture: SUPPORTED by repository implementation; browser-runtime behavior across arbitrary installed extensions NOT YET PROVEN.
- MCP retry-safe command cache: implementation present; exact-head CI validation NOT YET PROVEN in this Foundry run.
- Extension maliciousness from permissions/static references: REJECTED as an allowed inference.
- Per-extension usage telemetry from Chrome: NOT YET PROVEN / unavailable under the current product model; do not fabricate it.

## Privacy and safety boundary
- Keep raw browsing history local by default.
- Optional workflow-analysis permissions require explicit user action.
- Never silently disable or uninstall extensions.
- Never execute inspected extension JavaScript during static analysis.
- Never convert permission presence into a claim of observed collection or malicious behavior.

## Current blocker
Exact-head pull-request CI must execute the complete contract, including the newly explicit TypeScript check.

## Highest-EV next move
Consume CI unchanged. If green, connect the installed-agent inventory to analyzer output using a deterministic, privacy-preserving enrichment contract and tests that prove no raw browsing-history payload crosses that boundary. If CI fails, preserve the failure and repair only the demonstrated contract break.
