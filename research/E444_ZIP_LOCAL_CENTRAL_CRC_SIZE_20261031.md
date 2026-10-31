# E444 | Non-streaming ZIP local/central CRC32 and size consistency (2026-10-31)

## Continuity and falsifiable hypothesis
E439 required local/central compression methods and flags to agree, E441 validated bit-3 streaming descriptors, and E443 capped entry counts. The preflight did not compare the local CRC32 or sizes with central-directory metadata when bit 3 was clear. Hypothesis: syntactically valid classic ZIPs with conflicting non-streaming local CRC32 or size fields pass preflight despite contradictory metadata.

## Expected-red reproduction
Fetched the exact E443 helper `lib/zip-metadata.ts` (Git blob `76bdd30ada2a616080395b186cb1323ca1fd671f`). In the isolated V8 test harness, mechanically stripped TypeScript type annotations and executed the resulting function against deterministic classic STORE ZIP fixtures with correct local and central headers, EOCD, and zero/nonzero payload lengths. Flipped one local-header field at a time while keeping the central record unchanged:
- Local CRC32 at +14: accepted for empty and nonempty fixtures.
- Local compressed size at +18: accepted for empty and nonempty fixtures.
- Local uncompressed size at +22: accepted for empty and nonempty fixtures.

**Baseline negative result: 6/6 contradictory fixtures accepted.** This establishes an interpretation-integrity gap in the metadata validator, not exploitability or a JSZip parser vulnerability.

## Correction
When general-purpose bit 3 is **clear**, require the local CRC32, compressed size and uncompressed size to equal their central-directory counterparts. When bit 3 is **set**, preserve legal streaming archives whose local CRC/sizes are zero and whose post-payload data descriptor is checked by E441. No decompression, authentication, or production deployment changes.

## Executed validation
The corrected source-equivalent V8 implementation rejected all six contradictory fixtures, accepted four valid fixtures (empty and nonempty, streaming and non-streaming), and passed **10/10** assertions. Four Vitest cases (three negative and one compatibility positive) were added to `tests/zip-metadata.test.ts` but **not executed**. Full repository Vitest, TypeScript typecheck, production build, exact-head CI and real CRX compatibility remain unverified. No potentially billable Actions workflow was started.

## Limits and next experiment
- This is a strict canonical metadata policy. Real CRX archives with intentionally inconsistent non-streaming local fields could be rejected, even if JSZip previously loaded them.
- The fixture payloads were synthetic, not authorized real-world CRX2/CRX3 samples. CRC32 is not cryptographic authentication.
- Run the full repository suite in no-charge capacity, then measure acceptance against consented CRX2/CRX3 archives and inspect rejection reasons before any merge.
- Keep draft PR #38 stacked on #37 and #36, unmerged and undeployed.
