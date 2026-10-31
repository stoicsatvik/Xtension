# E437 | ZIP central/local metadata ambiguity (2026-10-31)

## Prior art and falsifiable defect
E436's metadata preflight rejects corrupt CRC32 for empty ZIP members but did not compare central-directory filenames to their local-header names, or reject repeated central-directory filenames. This permits ambiguous archive interpretation before JSZip is asked to load the package. No real malicious CRX or exploitation is claimed.

**Expected-red reproduction:** A deterministic Python `zipfile` fixture containing two entries named `manifest.json` was accepted by the exact E436 helper. A separate fixture whose local header named `manifest.jsox` while the central directory named `manifest.json` was also accepted. A valid ZIP with a comment, a Unicode empty member, and an empty archive remained accepted; the E436 corrupt-empty-member CRC fixture remained rejected.

## Bounded correction
On the existing E436 draft branch, extend the preflight (before JSZip) to reject byte-identical duplicate central filenames and repeated local-header offsets; require each central record's local-header offset and signature to be in bounds, and compare local and central filename bytes exactly. Keep data-descriptor ZIPs valid by **not** requiring local sizes or CRC fields to equal central fields. Existing E434 inflation bounds and E435/E436 CRC checks are unchanged. No ZIP member is decompressed by this preflight.

## Validation actually executed
- Original E436 exact-source helper: both duplicate-name and local/central-name-conflict fixtures were **accepted** (expected-red).
- Updated helper: 10/10 standalone Node 22.16.0 assertions **passed** (four valid fixtures: ordinary/comment, Unicode, empty archive, data-descriptor; six invalid/malformed controls: duplicate names, local filename conflict, corrupt empty CRC, invalid local offset, inconsistent count, truncated EOCD).
- Forty additional deterministic Python-generated ordinary ZIPs were accepted (40/40).
- `tsc --noEmit --strict --target es2022 --module commonjs zip-metadata.ts` passed (TypeScript 5.8.3).
- Local `git hash-object` of the tested helper: `1667709a6b07b563ef0ddd9686ebc4844abcdc05`; local Vitest source blob: `a725b63b5c93a8118819430688862adebe8c1d40`. These match the respective committed GitHub blobs.
- Three new Vitest regression/integration cases were committed, but **Vitest, full repository typecheck/build, and exact-head CI were NOT run**. The GitHub account previously reported exhausted included Actions minutes; commits use `[skip ci]` to avoid triggering potentially billable workflows.

## Preserved negative result and boundaries
A fixture with both `manifest.json` and `../manifest.json` is **still accepted by the metadata preflight**; whether JSZip sanitization causes a collision must be tested separately. Byte-exact duplicate detection is not equivalent to canonical-path collision detection. The parser also does not prove payload authenticity, check overlapping compressed-data regions, verify all local/central flags and compression methods, or establish compatibility with real CRX samples. It conservatively rejects ZIP64, split ZIP and some nonstandard layouts as already documented in E436. CRC32 is not a cryptographic signature.

## Next falsifiable gate
Use a verified no-charge environment to run `npm test`, `npm run typecheck`, and `npm run build` on the exact PR head. Then test real authorized CRX ZIP layouts, normalized-path aliases, and local/central metadata discrepancies before considering integration. Keep this PR draft and stacked on E435 #37 and E434 #36; do not merge or deploy.

No production data, extension execution, external outreach, payment or deployment occurred.
