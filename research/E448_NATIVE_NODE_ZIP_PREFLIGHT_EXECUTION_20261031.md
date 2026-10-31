# E448: execute exact committed ZIP preflight under native Node (2026-10-31)

## Falsifiable integration question
Does the *unchanged*, committed E447 smoke script actually import and execute the *unchanged*, committed E444 TypeScript ZIP preflight under Node 22.16.0, rather than only passing a mechanically stripped V8 approximation?

## Source provenance
Fetched both files from PR #38's head branch using GitHub file reads, reconstructed an isolated two-file workspace, and independently calculated Git blob SHA-1s from the on-disk bytes:
- `lib/zip-metadata.ts`: `747606b773c61d5c5ddff248766e9420d284a273` (matches GitHub).
- `scripts/zip-preflight-smoke.mjs`: `0f33a57900ac9acad0833a70ef15786801e0f285` (matches GitHub).

No source transformations, mocks, dependency installs or changes to the two files were used.

## Executed checks
- Node `v22.16.0`: `node --experimental-strip-types scripts/zip-preflight-smoke.mjs` **PASS 14/14**, with all original E436/E439/E440/E441/E443 gate outcomes and the CRC32 known-answer/fixture-integrity controls.
- Installed TypeScript compiler: `tsc --noEmit --strict --target ES2022 --module NodeNext --moduleResolution NodeNext --lib ES2022,DOM --skipLibCheck lib/zip-metadata.ts` **PASS** for the exact helper source.
- Independent compatibility probes generated using Python's standard-library `zipfile`: classic DEFLATE with ASCII names, classic DEFLATE with UTF-8 `é.js`, and STORE including an empty member. Native Node imported the exact helper and **accepted 3/3**.
- Expected negative control retained: when both central and local CRC32 fields for a nonempty member are changed consistently, preflight **ACCEPTS** it. That is intentional: downstream streamed CRC verification is required and was **not** exercised here.

## Boundary and next gate
This was a source-identical **two-file isolated checkout**, not a full repository checkout. `vitest` and `jszip` packages were unavailable locally; repository-wide Vitest, full typecheck, Next.js production build, exact-head CI, CRX2/CRX3 parsing, and authorized real-CRX compatibility remain **NOT VERIFIED**. The Python `zipfile` probes are independent real ZIP encoders, **not CRX files**. No billable GitHub Actions job was started (included minutes previously exhausted).

No production code or test logic needed modification based on these checks. The evidence advances E446/E447 from source-equivalent V8 checks to native Node execution of byte-identical committed files. Keep PR #38 draft, stacked on #37/#36, and do not merge until full integration and real CRX compatibility are checked.
