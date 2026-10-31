# E446: exact committed ZIP metadata preflight smoke harness (2026-10-31)

## Decision
Stop adding ZIP safeguards until integration evidence exists. E445 repaired fixtures using a partial metadata-gate model, leaving uncertainty about whether those malformed archives reach the intended checks in the **complete committed E444 helper**.

## Falsifiable hypothesis
The four E445 corrected fixture constructions, plus representative earlier controls, should produce the intended accept/reject outcomes when executed against the exact committed `lib/zip-metadata.ts` helper, not a hand-written subset of its gates.

## Implementation
Added `scripts/zip-preflight-smoke.mjs`, a dependency-free classic-ZIP fixture generator and assertion runner. It imports the repository's real TypeScript validator with Node 22.16+ experimental type stripping:

```sh
node --experimental-strip-types scripts/zip-preflight-smoke.mjs
```

The script tests 11 controls: valid classic and streaming ZIPs; E439 compressed-payload boundary; three E440 overlap variants (non-streaming, streaming descriptor, and syntactically valid extra-field TLV); E436 empty CRC; E441 streaming descriptor CRC; E443 entry-count boundary at 2,000 and 2,001; and an explicit **negative control** showing that the preflight does not authenticate nonempty CRC32 (that check is delegated to downstream streamed reading).

## Executed validation
- Fetched exact GitHub helper blob `747606b773c61d5c5ddff248766e9420d284a273` from the PR #38 head.
- Mechanically removed TypeScript-only annotations and generics without changing executable logic; compiled the resulting JavaScript in V8.
- Executed the smoke script's test body against that helper. **11/11 passed**, including all four E445 fixture-gate reachability checks.
- Separately verified Node **22.16.0** accepts `import { ... } from "../lib/zip-metadata.ts"` with `--experimental-strip-types` using a minimal local TypeScript module.

## Important limits
The committed script has **not** been run against the actual GitHub checkout in Node. The V8 run used mechanically stripped but source-equivalent helper code. It did not import JSZip or execute Vitest, the full analyzer, the production build, or actual CRX2/CRX3 samples. Synthetic ZIP bodies are not authenticated; CRC32 is not a cryptographic signature. The negative control intentionally demonstrates this limited scope.

## Next gate
In a local checkout with no GitHub Actions billing, run the committed script, then `npm ci && npm run test && npm run typecheck && npm run build`. Preserve any failing test output and use authorized CRX2/CRX3 fixtures before merging stacked PRs #36–#38. No deployment, merge, or external outreach is warranted yet.
