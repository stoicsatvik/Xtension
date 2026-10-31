# E445: restore ZIP regression-test reachability after E441–E444 guards (2026-10-31)

## Why this follow-up

The E436–E444 stacked draft added earlier rejection gates, but some inherited E439/E440 tests mutated only central-directory fields and continued asserting that a *later* boundary or overlap gate would reject the archive. In particular:

- E439's oversized central compressed-size fixture now conflicts with E444's local-header compressed-size equality check, so it would fail at the earlier E444 gate.
- E440's non-streaming compressed-size overlap fixture similarly conflicted with E444.
- E440's streaming compressed-size overlap fixture had no matching descriptor at the newly declared data end, so E441 could reject it before the overlap check.
- E440's enlarged local-extra fixture lacked a syntactically valid extra-field structure, so E442 could reject it before the overlap check.

These are **test-fixture reachability problems**, not evidence that the production validator accepted unsafe archives. Merely widening assertion regexes would conceal whether the intended invariants are still tested.

## Correction

Only `tests/zip-metadata.test.ts` changed. Preserve the intended failure stage by:

1. Updating both local and central compressed sizes in the E439 bounds fixture.
2. Updating both local and central compressed sizes in the E440 non-streaming overlap fixture.
3. Constructing a bit-3 streaming archive with a consistent signed descriptor deliberately placed inside the next member's payload. The next local header remains intact.
4. Giving the enlarged local extra field a syntactically valid unknown TLV header whose payload crosses the next local-header range. This keeps E442 extra-field parsing satisfied.

No production source, package dependencies, workflow settings, or deployment changed.

## Executed offline validation

Node 22.16.0 with locally available JSZip was used to generate the fixtures. A small **targeted metadata-gate model**, following the E439/E440/E441/E442/E444 check ordering, confirmed the four corrected fixtures reach their intended gates:

| Fixture | Expected gate | Targeted model result |
| --- | --- | --- |
| Oversized non-streaming payload | E439 bounds | E439 bounds |
| Non-streaming payload overlaps next header | E440 overlap | E440 overlap |
| Streaming payload overlaps next header with consistent descriptor | E440 overlap | E440 overlap |
| Validly encoded local extra field overlaps next header | E440 overlap | E440 overlap |

**4/4 targeted fixture checks passed.** This was *not* execution of the exact repository validator or Vitest. The harness uses only the relevant subset of metadata checks and does not establish that the full integration suite passes. No GitHub Actions workflow was launched.

## Remaining validation gate

Run the actual `tests/zip-metadata.test.ts` suite and complete repository typecheck/build locally in a no-charge environment; confirm the E434–E444 stack against authorized real CRX2/CRX3 archives. Keep draft PR #38 unmerged and stacked on #37/#36. If the real tests reveal an unexpected earlier rejection, preserve the failure and revise the fixture rather than weakening validation.

## Research conclusion

Security regressions can become false-positive test passes or unexpected failures when newer checks preempt the invariant a test was meant to exercise. Tests should construct **otherwise-consistent malformed archives** to isolate one falsifiable property at a time.
