# E443 | Preflight ZIP entry-count bound (2026-10-31)

## Continuity and falsifiable hypothesis
E434 bounded inflated bytes but Xtension's `MAX_FILES = 2_000` guard in `analyzePackage` runs **after** `JSZip.loadAsync` has already allocated and indexed all ZIP entries. E442's metadata preflight also traversed all central-directory records without an early count limit. Hypothesis: a small, syntactically valid archive with 2,001 zero-length members is accepted by the metadata preflight even though the application will later reject it, causing avoidable parsing and object allocation.

## Expected-red evidence
The exact E442 `lib/zip-metadata.ts` source (Git blob `f81d4d9e98675d98523bf2a91eb9e79d8cbd0a6a`) was fetched and mechanically converted from TypeScript annotations to executable JavaScript in the tool's V8 runtime. Deterministic classic STORE ZIP fixtures with valid local/central headers and zero-byte entries were constructed in memory. The baseline preflight **accepted** 2, 2,000, and **2,001** entries. The 2,001-entry fixture occupied **188,116 bytes**, below the 25 MiB package cap. No JSZip or production server was invoked for this experiment.

## Correction
Reject an EOCD-declared central-directory count above 2,000 before parsing individual entries or calling JSZip. This is a cheap pre-allocation guard; existing central-directory count-consistency and ZIP-integrity checks remain in force. Direct calls to the helper now enforce the same conservative entry cap.

## Executed validation
The corrected helper, with only TypeScript annotations mechanically removed, **accepted 2 and 2,000** deterministic zero-length entries and **rejected 2,001** with `ZIP contains more than 2000 entries`. The test fixture was valid classic ZIP metadata, not a real-world CRX. Two Vitest regression cases were added to `tests/zip-metadata.test.ts` for the 2,000/2,001 boundary, including an `analyzePackage` rejection assertion; **these Vitest cases were not executed**. Full repository tests, typecheck, build, exact-head CI and real CRX corpus compatibility remain unverified. No potentially billable Actions workflow was started; commits use `[skip ci]`.

## Negative and compatibility boundaries
- The cap counts **all** central-directory entries, including directories, while the prior `MAX_FILES` check counted only non-directory entries. A valid archive with at most 2,000 files plus many directory records can now be rejected. This conservative tradeoff requires authorized CRX corpus measurement before merge.
- The preflight does not prove a global memory ceiling for JSZip, does not authenticate ZIP contents, and does not establish exploitability in the wild.
- If the EOCD count is falsified downward, the existing final central-directory byte-consumption check still rejects the inconsistent record count; this specific bypass was not separately executed.
- All E434–E443 changes remain in the existing **draft, unmerged** stacked PR #38 (on #37 and #36).

## Next falsifiable gate
Run `npm test`, `npm run typecheck`, and `npm run build` in verified no-charge capacity at the exact PR head. Then evaluate acceptance/rejection rates and resource usage against a consented CRX2/CRX3 corpus, recording false rejects due to directory entries or legacy filename encoding. Do not merge or deploy before those checks.
