# E447: ZIP smoke fixture CRC32 validity (2026-10-31)

## Falsifiable question

Did E446's tests named "valid classic" and "valid streaming" actually generate valid classic STORE ZIP members, or merely metadata-preflight-accepted byte arrays?

## Expected-red observation

Fetched the exact committed E446 smoke harness (blob `29c06bfd44c788d600322ae07f9496e1a6966fed`) and built its default archive without modifying the implementation. The first member's 51-byte manifest had independently calculated PKZIP CRC32 `0x5dd51061`, while both local and central CRC32 fields were `0x00000000`. The streaming descriptor similarly omitted a correct CRC32. Thus the old harness labeled archives with inconsistent content checksums as valid. This is a **test-fixture defect**, not a new production validator bypass: the preflight intentionally does not decompress or recompute nonempty member CRCs.

## Correction

Updated `scripts/zip-preflight-smoke.mjs` only. Generate actual CRC32 values for stored member bodies and write them into local headers, central-directory records and streaming descriptors. Add the published `123456789 -> 0xCBF43926` CRC32 known-answer check and two checks that validate stored member CRCs and descriptor metadata in the valid classic/streaming fixtures.

## Executed validation

Retrieved the exact E444 production helper blob `747606b773c61d5c5ddff248766e9420d284a273`. Mechanically removed TypeScript-only syntax and evaluated it together with the patched smoke harness in the isolated V8 environment. **14/14 assertions passed**, including all 11 original preflight outcomes and three new CRC32 controls. The original malformed manifest CRC was independently measured before patching.

## Preserved negative result and limitations

The negative control where both local and central CRC32 are changed consistently still passes metadata preflight. That is expected: downstream bounded streaming checks content CRC32, and CRC32 is not authentication. This experiment did **not** execute the committed script through Node's native TypeScript stripping, install dependencies, run Vitest/typecheck/build, or exercise real CRX2/CRX3 archives. Do not infer compatibility or production security from these synthetic tests.

## Next gate

Execute `node --experimental-strip-types scripts/zip-preflight-smoke.mjs` in an actual checkout with Node >=22.16, followed by full repository Vitest/typecheck/build and authorized CRX corpus checks in verified no-charge capacity. Keep stacked PR #38 draft and unmerged.
