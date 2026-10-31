# E438 | Reject ZIP pathname normalization ambiguities (2026-10-31)

## Prior art and falsifiable question
E437 rejected byte-identical central-directory names and mismatched local/central names, but documented that a ZIP containing `manifest.json` and `../manifest.json` passed the metadata preflight. JSZip 3.8+ intentionally sanitizes relative components on `loadAsync`, and its documentation says entries with the same loaded name replace earlier ones. Thus byte-exact uniqueness does not establish uniqueness *after loading*. This is a synthetic interpretation-integrity risk, not proof of a live attack, file extraction, or actual extension compromise.

Upstream reference: https://stuk.github.io/jszip/documentation/api_jszip/load_async.html

**Expected-red test:** reconstruct the exact E437 helper (Git blob `1667709a6b07b563ef0ddd9686ebc4844abcdc05`) and pass eight small Python `zipfile` archives with noncanonical central/local filenames: `../manifest.json`, `a/../manifest.json`, `./manifest.json`, `a/./file.js`, `/manifest.json`, `..\\manifest.json`, `a//file.js`, and a raw NUL-containing name. The original helper accepted **all 8/8**. For the NUL case, both the local and central filename bytes were patched in place, since Python `zipfile` truncates NUL names on writing.

## Correction
In `lib/zip-metadata.ts`, reject empty raw names, leading slash, backslash, NUL, repeated forward slash, and path components exactly `.` or `..` before JSZip loads the archive. This is a fail-closed preflight operating on ASCII structural bytes, not on lossy Unicode decoding. Valid Unicode and ordinary dotted filenames remain permitted. E434 byte-bounded inflation and E435/E436 CRC checks are unchanged.

## Executed validation and limitations
- Reconstructed baseline file hash: `1667709a6b07b563ef0ddd9686ebc4844abcdc05`, matching the previously committed E437 helper.
- Expected-red baseline: **8/8 unsafe archive fixtures accepted**.
- Corrected standalone helper: **8/8 unsafe archive fixtures rejected**, **45/45 valid ZIP fixtures accepted** (ordinary, comments, nested paths, Unicode, dotted basename, and 40 deterministic variants).
- `tsc --noEmit --strict --target es2022 --module commonjs zip-metadata.ts` passed under TypeScript 5.8.3 and Node 22.16.0.
- Corrected local Git blob: `204396279f42713a32b497cbc69e8c939da84ea9`, matching the GitHub committed helper.
- Vitest regression/integration cases were committed, but **Vitest, full repository typecheck/build, and exact-head CI were not executed**. The local test harness exercises the preflight with Python-generated ZIPs, not the full JSZip/Next.js integration. No paid Actions workflow was started; commits use `[skip ci]` after the previous included-minute exhaustion notice.

## Preserved negative/unknown results
- JSZip's documented sanitization is upstream evidence, not a direct local JSZip execution in E438; exact collision behavior with these fixtures remains to be integration-tested.
- The fail-closed rule may reject uncommon but legitimate archive names (for example `./file.js`); real authorized CRX compatibility has not been established.
- Unicode extra-field overrides, invalid UTF-8 replacement collisions, conflicting metadata, overlapping compressed payloads, and cross-platform drive-relative aliases are not fully validated.
- CRC32 is not cryptographic authentication, and this does not establish that an extension is benign or malicious.

## Next falsifiable gate
Run the committed Vitest cases, full typecheck and production build on the exact draft head using verified no-charge capacity. Exercise authorized real CRX layouts, Unicode path decoding/extra fields, and local-versus-central metadata conflicts. Keep PR #38 draft and stacked on #37/#36; do not merge or deploy without integration and compatibility review.

No user data, production environment, external outreach, payment, or installed extension was touched.
