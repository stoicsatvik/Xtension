# E441: ZIP streaming data-descriptor integrity (2026-10-31)

## Question and falsification
Can the E440 classic-ZIP metadata preflight accept a streaming archive whose post-payload data descriptor contradicts the central directory, or is truncated, while its local/central header fields and payload interval otherwise agree?

**Yes.** The E440 helper blob `62ce67fe3bf06458ad1eedcb0de702fbcc90e6a2` accepted all three focused malformed metadata-only fixtures: a flipped descriptor CRC32, a flipped descriptor compressed size, and a truncated signed descriptor. The central directory and local header were otherwise consistent. This is a synthetic integrity-counterexample, **not** a demonstrated exploit or real-world CRX attack.

## Correction
For each member with general-purpose bit 3 set, compute the descriptor start immediately after the central-declared compressed payload. Require the descriptor CRC32, compressed size and uncompressed size to agree with the central record. Support both the 16-byte signature-prefixed and 12-byte signature-free classic descriptors, including the ambiguity where an unsigned descriptor's CRC happens to equal the optional signature magic. Include descriptor bytes in the disjoint local-member interval, so a descriptor cannot overlap another local header. Existing filename, local/central method/flag, CRC and payload-bound checks remain.

The exported function name `validateEmptyZipCrc` is retained to avoid breaking callers, although its checks now cover more than empty-member CRC.

## Reproducibility and evidence
- Source before: `lib/zip-metadata.ts` Git blob `62ce67fe3bf06458ad1eedcb0de702fbcc90e6a2`.
- Source after: Git blob `49f9494786ba0df6966053415b38e5fc7b01c2ec`.
- Exact committed TypeScript function body was converted mechanically to executable JavaScript by stripping TypeScript-only annotations; no logic was altered. That source-equivalent local check passed **72/72** deterministic metadata fixtures: eight focused cases (signed, unsigned, ordinary, multi-member, three inconsistent descriptor fields, truncated descriptor) plus 64 additional valid-name/layout cases.
- Three malformed fixtures were accepted by the E440 source-equivalent baseline and rejected after the change.
- Added repository Vitest cases for three signed-descriptor field mutations, a valid unsigned descriptor, and a missing descriptor using JSZip-generated streaming archives. **These five Vitest cases were committed but not executed.**
- No full repository Vitest, typecheck, production build, exact-head GitHub Actions, or real CRX compatibility test was executed. Earlier GitHub account email reported the 2,000 included Actions minutes exhausted. Commits use `[skip ci]`; no paid CI rerun was requested.

## Negative results and limitations
- A descriptor whose values exactly match the central directory is internally consistent; this is not cryptographic authentication. CRC32 can be deliberately recomputed.
- The preflight intentionally supports only classic 32-bit descriptor sizes; ZIP64, split archives, unusual prefixes and trailing data remain unsupported by the inherited conservative policy.
- Source-equivalent metadata fixtures do not prove JSZip integration or actual browser-extension compatibility. The committed Vitest cases, particularly unsigned-descriptor parsing by JSZip, are a **pending integration gate**, not a passed result.
- Full E434–E441 stack is draft, unmerged, and must be tested with authorized real CRX/ZIP fixtures and full repository tests before integration.

## Next falsifiable experiment
Run the committed Vitest suite and full build/typecheck in verified no-charge capacity. Assemble a small authorized corpus of ordinary and streaming CRX ZIPs (including signature-free descriptors) to quantify compatibility rejects. Then investigate Unicode path extra fields and differences between raw ZIP filename bytes and JSZip-decoded filenames. Do not make exploit or production-safety claims from synthetic fixtures alone.
