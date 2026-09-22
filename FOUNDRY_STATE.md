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
- Current validated branch head before this evidence-only state update: `ed62dc62e1baa7cc32bbf2228061bdbb23032625`.
- Exact-head GitHub Actions CI run `35554318889`: SUCCESS.
- The successful CI validates the branch's explicit TypeScript checking together with the existing automated test/build contracts.
- This branch makes `npm run typecheck` an explicit CI contract rather than leaving a defined TypeScript check outside automation.

## Claim states
- Public/static analyzer software contract: SUPPORTED at the validated branch head by exact-head CI.
- Local agent software/manifest contract: SUPPORTED at the validated branch head; browser-runtime behavior across arbitrary installed extensions remains NOT YET PROVEN.
- MCP package/build contract: SUPPORTED at the validated branch head by exact-head CI; production reliability under arbitrary clients remains NOT YET PROVEN.
- Extension maliciousness from permissions/static references: REJECTED as an allowed inference.
- Per-extension usage telemetry from Chrome: NOT YET PROVEN / unavailable under the current product model; do not fabricate it.

## Privacy and safety boundary
- Keep raw browsing history local by default.
- Optional workflow-analysis permissions require explicit user action.
- Never silently disable or uninstall extensions.
- Never execute inspected extension JavaScript during static analysis.
- Never convert permission presence into a claim of observed collection or malicious behavior.

## Current blocker
No CI blocker remains for this branch. The next product increment must preserve the privacy boundary while joining installed-agent inventory with analyzer output.

## Highest-EV next move
Connect installed-agent inventory to analyzer output using a deterministic, privacy-preserving enrichment contract. Add fixtures proving raw browsing-history payloads cannot cross the boundary, and preserve the distinction between declared capability, static references, locally observed workflow relevance, and observed malicious behavior.
