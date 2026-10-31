# E442 | Unicode Path extra-field filename aliasing (2026-10-31)

## Starting point and prior art
E437/E438 rejected byte-identical duplicate central filenames and noncanonical raw path segments. E441 added data-descriptor integrity. The open stacked draft PR #38 had no human review comments. This experiment follows E441's explicit unresolved Unicode extra-field interpretation question; it is not an unrelated new feature.

## Falsifiable hypothesis and exact-source expected-red result
Hypothesis: distinct central-directory raw filename bytes can resolve to one filename after JSZip 3.10.1 interprets the Info-ZIP Unicode Path extra field (0x7075), bypassing byte-exact duplicate detection.

The E441 helper was fetched at Git blob `49f9494786ba0df6966053415b38e5fc7b01c2ec` and reproduced byte-for-byte locally (`git hash-object` matched). JSZip 3.10.1 generated two entries, `é.js` and `ø.js`, with different UTF-8 raw names and their own 0x7075 extra fields. In a controlled 261-byte archive, both UTF-8 header flags were cleared and the second Unicode Path payload was changed to `é.js`, while retaining its valid CRC of the unchanged raw name `ø.js`. The exact E441 metadata helper **accepted** the archive. Actual `JSZip.loadAsync` returned **one** entry named `é.js` with content `second`: the first entry was silently replaced. This is an archive interpretation collision, not evidence of an exploited CRX in the wild.

## Bounded correction
Before JSZip loads the archive, inspect central and local extra-field records within their existing length bounds. Reject duplicate, malformed or contradictory 0x7075 Unicode Path fields; require their declared UTF-8 name bytes to equal the raw filename bytes. Validate UTF-8 strictly when bit 11 is set, and reject non-ASCII raw names without that flag rather than guessing a legacy code page. These rules make JSZip's raw-name and Unicode-extra-field interpretations agree. No member decompression, production deployment or network activity is added.

## Validation actually executed
- **Expected red:** exact E441 source accepted the malformed archive, and real JSZip 3.10.1 collapsed two names into one.
- **Corrected exact source:** `lib/zip-metadata.ts` blob `f81d4d9e98675d98523bf2a91eb9e79d8cbd0a6a` matches the locally compiled and tested source.
- **47/47 offline assertions passed:** normal Unicode ZIP, malformed alias rejection, real JSZip collapse reproduction, contradictory 0x7075 metadata with UTF-8 flag, legacy encoding rejection, invalid UTF-8 rejection, malformed extra-field rejection, and 40 deterministic valid ZIP archives with Unicode paths, optional comments, streaming descriptors, and DEFLATE.
- `tsc --target es2022 --module commonjs --strict --skipLibCheck` passed for the exact helper.
- Five new Vitest cases were committed in `tests/zip-metadata.test.ts` but **not executed through Vitest**. Full repository typecheck, production build, exact-head CI and real-world CRX compatibility were **not executed**. No potentially billable GitHub Actions workflow was initiated.

## Negative and compatibility boundaries
- The conservative encoding policy **rejects legacy non-UTF-8 ZIP filenames** even when a valid 0x7075 field could provide a Unicode interpretation. This may reject some legitimate historical archives and must be tested on authorized CRX fixtures before merge.
- A Unicode Path field with mismatched name bytes is rejected even if JSZip would ignore it due to bit 11; this is intentionally fail-closed.
- The patch does not establish archive authenticity or malicious-code detection. CRC32 is not a signature.
- Full repository Vitest and real CRX compatibility remain unverified. The PR stays draft, stacked on #37 and #36, and must not be merged/deployed until integration validation.

## Next falsifiable gate
On a verified no-charge runner, run `npm test`, `npm run typecheck`, and `npm run build` at the exact PR head. Then compare the acceptance/rejection rates of the E434–E442 stack on an authorized, diverse corpus of real CRX2/CRX3 archives. Investigate additional extra-field aliases only if a counterexample survives these checks.
