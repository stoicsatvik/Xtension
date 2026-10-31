# E439 | Reject conflicting ZIP local/central metadata (2026-10-31)

## Context and falsifiable question
E436-E438 validate EOCD/central boundaries, filenames, duplicate offsets, and empty-member CRC32, but only compare **filename bytes** between each local header and central-directory record. Can conflicting compression methods, general-purpose flags, or an oversized local extra field pass the preflight? Yes.

This is a synthetic archive interpretation-integrity issue. It does **not** establish malicious extensions, successful code execution, or a real-world exploit.

## Expected-red reproduction
Using the E438 source-equivalent `validateEmptyZipCrc` implementation, Python `zipfile` generated ordinary DEFLATE archives and nonseekable-output archives using data descriptors. A single local or central header field was modified per fixture without changing its matching counterpart.

The original preflight **accepted 12/12 intentionally malformed fixtures**:
- Local flags mismatch and central flags mismatch (two variants per archive layout).
- Local compression method mismatch and central method mismatch (two variants per layout).
- Local extra-field length extending past the start of the central directory.
- Central compressed-size claim extending past the start of the central directory.

It also accepted the two original valid layouts.

## Correction
- Require local and central general-purpose flags to match.
- Require local and central compression methods to match.
- Require the local header + filename + extra field to end before the central directory.
- Require the central compressed-size claim to fit before the central directory, including data-descriptor archives where local size fields may be zero.

This is a metadata-only check. No decompression or additional network access is introduced. The previous E434 streaming inflation limits, E435/E436 CRC checks, and E437/E438 name guards remain unchanged.

## Executed offline controls
- Baseline: 12/12 corrupted fixtures **accepted** (expected-red).
- Corrected source-equivalent helper: 12/12 corrupted fixtures **rejected**.
- Corrected source-equivalent helper: 42/42 valid fixtures **accepted**, including two data-descriptor/nonseekable layouts, comments, Unicode paths, and 40 varied synthetic files.
- Strict standalone TypeScript compilation passed with Node 22.16.0 / TypeScript 5.8.3.
- Six new repository Vitest cases were committed but **not executed**.

## Remaining uncertainties and negative boundaries
- Offline checks used a source-equivalent local helper and Python `zipfile` archives, not an exact-head Next.js/JSZip test run.
- Valid real-world CRX fixtures and less-common ZIP producers were not sampled; rejecting conflicting headers may affect nonconforming archives.
- This does not yet reject overlapping local payload ranges between distinct entries, Unicode extra-field aliases, or cryptographic tampering.
- ZIP64 and split archives remain unsupported by the existing conservative parser.
- Full repository Vitest, build, typecheck, and exact-head CI remain unverified. The included GitHub Actions minutes were previously exhausted; no potentially billable workflow was started.

## Next gate
Run the committed Vitest cases and full repository validation in verified no-charge capacity. Then test authorized real CRX files and inspect local-payload overlaps / Unicode extra-field interpretations before merging the stacked E434-E439 changes.

No production data, installed extensions, payments, deployments, or external communications were touched.
