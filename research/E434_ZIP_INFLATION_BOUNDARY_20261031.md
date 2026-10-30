# E434 | Xtension ZIP inflation-boundary falsification (2026-10-31)

## Question
Does a 25 MiB compressed-archive ceiling protect the CRX analyzer against large uncompressed ZIP members?

## Source-inspected precondition
On the pre-E434 main branch, `analyzePackage` checks `crxBytes.byteLength <= 25 MiB` and at most 2,000 files, then calls `manifestFile.async("text")` and `entry.async("text")`. It slices JavaScript text only *after* full decompression. Thus neither `MAX_JS_FILE_CHARS` nor `MAX_TOTAL_SCANNED_CHARS` is a memory bound on the decompressor. This is a source-level vulnerability, not evidence of an attack in the wild.

## Independent synthetic counterexample
A ZIP containing a 2,000,000-byte repetitive JavaScript member plus a small manifest compresses to **2,238 bytes** using JSZip DEFLATE level 9. Seven 900,000-byte JavaScript members (6.3 MB total) plus a minimal manifest compress to **7,044 bytes**. Both are far below the old 25 MiB compressed-size gate. These are deterministic, non-executable text fixtures.

## Correction
- New `lib/zip-bounds.ts` consumes JSZip's uncompressed `uint8array` stream in bounded chunks.
- Reject a member immediately when a chunk would exceed its per-entry byte cap or the shared byte budget, and pause the stream on rejection.
- Manifest cap: 256 KiB; each JS file: 1,000,000 bytes; all scanned JS members together: 6,000,000 bytes.
- Reject over-budget input instead of silently truncating the scan and presenting a potentially incomplete report.
- Preserve valid UTF-8, ordinary package analysis and existing compressed-size/file-count limits.
- No extension JavaScript is executed, no live extensions are fetched, and no installed browser state is changed.

## Local validation
Node 22.16.0, JSZip from the local pptxgenjs dependency, no network access:
- Six independent `node --experimental-strip-types --test` helper tests passed: ordinary text, 2 MB compressed bomb, cumulative budget, zero cap, invalid budgets, UTF-8.
- Strict standalone TypeScript compilation of `zip-bounds.ts` passed with `tsc --noEmit --strict --target es2022 --module nodenext --moduleResolution nodenext`.
- Five repository Vitest integration/regression tests committed, but **not executed locally**. Full Next.js typecheck/build and exact-head CI remain **NOT YET VERIFIED**.

## Claim boundaries
The unbounded pre-fix inflation path is **SUPPORTED BY SOURCE INSPECTION**. The bounded stream helper is **SUPPORTED IN LOCAL TESTS**. Full Xtension integration, runtime compatibility of JSZip's `internalStream`, and resistance to all malformed/hostile ZIP variants are **NOT YET PROVEN**. This does not establish that any real Chrome extension is malicious.

## Next discriminating tests
1. Run the committed Vitest suite and Next.js production build at the exact final head.
2. Test adversarial ZIP metadata, malformed CRC, fragmented multi-byte UTF-8, and near-cap valid archives.
3. Verify memory high-water mark under bounded inflation with a fixed runtime limit.
4. Consider a documented streaming ZIP parser if the internal JSZip stream interface proves unstable.

Draft PR only. Do not merge or deploy without integration validation.
