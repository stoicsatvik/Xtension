# E436 | Empty ZIP member CRC32 metadata gate (2026-10-31)

## Prior art and falsifiable defect

E435 (draft PR #37) checks CRC32 during bounded decompression of nonempty ZIP members, but documented a remaining blind spot: JSZip 3.10.x exposes no original CRC metadata on loaded zero-byte entries. A central-directory entry with uncompressed size 0 and deliberately corrupted CRC32 was accepted and decoded to an empty string. This is a **synthetic archive-integrity counterexample**, not evidence of a real-world attack or proof of package authenticity.

**Expected-red baseline:** using Node 22.16.0 and JSZip 3.10.1, generate a ZIP containing an empty `empty.js`, then change only its central-directory CRC32 from 0 to 1. `JSZip.loadAsync(corrupt)` accepts it, and `zip.file("empty.js").async("text")` returns `""`.

## Correction

Add a metadata-only preflight before JSZip loads the package. It locates the end-of-central-directory record within the ZIP comment bound, validates the single-disk classic ZIP central-directory offset/count/record boundaries, and rejects a zero-uncompressed-length member whose declared CRC32 is nonzero. This preserves legitimate empty files without inflating any member. It runs after the existing 25 MiB package-size gate and CRX header stripping. E435's streamed CRC and byte bounds remain unchanged.

**Fail-closed compatibility tradeoff:** split archives, ZIP64 central directories, self-extracting prefixes, malformed record counts, and trailing data are rejected. This is an intentionally conservative classic-ZIP policy and needs compatibility review against real CRX packages. The parser is not a complete ZIP verifier and does not yet detect duplicate names, local-header conflicts, recomputed CRCs, or malicious JavaScript.

## Executed offline evidence

- Reproduced the original empty-member CRC acceptance using JSZip 3.10.1.
- Seven standalone metadata controls passed after the change: valid archive with comment, corrupt empty CRC rejection, truncated EOCD rejection, inconsistent count rejection, ZIP64 sentinel rejection, Unicode empty filename acceptance, and empty archive acceptance.
- `tsc --noEmit --strict --target es2022 --module nodenext --moduleResolution nodenext zip-metadata.ts` passed.
- Local helper Git blob SHA: `a6a3feb307f7fafddbceacef642c460d8e7e6233`. Compare against the committed GitHub blob before treating this as exact-source validation.
- Seven Vitest integration/regression cases were committed to `tests/zip-metadata.test.ts`, including the actual `analyzePackage` path. **These repository Vitest cases and the full Next.js build have NOT run.** No GitHub Actions workflow was deliberately started because the previous billing notice reported exhausted included minutes.

## Next gate

Run the exact branch-head repository tests, typecheck and production build in verified no-charge capacity. Audit real CRX ZIP variants for false rejects before integration. Investigate duplicate central-directory names and local/central header inconsistencies separately. This branch is stacked on E435 #37 and E434 #36, and must not be merged or deployed independently.

No user data, production deployment, payment, or external communication was changed.
