# E224 — Revoked long-poll responses must not execute browser commands

Date: 2026-10-25 (Asia/Kolkata). Draft PR #17 stacked on E223 PR #16. No merge or deployment.

## Falsifiable invariant

If a browser pairing is rotated from token A to token B, or disconnected, while an A-authenticated `/v1/commands?wait=20000` request is outstanding, a later response from that request must not mutate local browser state or acknowledge its commands. A command from the still-current pairing must remain executable.

## Preserved negative result

The E223 agent restarted polling when the pairing changed but did not revalidate generation or credentials after the pending fetch resolved. A deterministic Chrome/fetch mock held the A long poll, rotated to B or removed the pairing, and then released a `set-verdict` command.

At test-only head `38fb54db7eca4494ffd205df53872cb16e87b71f`, [PR CI #40123639239](https://github.com/stoicsatvik/Xtension/actions/runs/40123639239) reported **2/3 tests failed**: both revoked-response scenarios mutated preferences once (expected zero). The current-pairing control passed. These are application invariant failures, not CI infrastructure failures.

## Narrow correction

`agent/background-mcp-bridge.js` now checks the current polling generation **and** the persisted pairing token after the long-poll response and at command-dispatch boundaries. If either differs, it abandons the old loop without processing or acknowledging commands. Before post-command acknowledgements and follow-up sync it checks again.

Tests: `tests/mcp-bridge-revoked-poll-command.test.js`. CI: `.github/workflows/e224-revoked-poll-command.yml`.

## Validation and limitations

The experiment uses isolated in-memory Chrome storage, a mocked fetch endpoint, and real agent-module import. It does not modify real browser extensions or user evidence. Validate E224 plus inherited E222/E223 tests and syntax on the final exact head before review.

**Not proven:** an atomic revocation barrier if Chrome storage changes between the last guard and a mutating asynchronous browser operation; Chrome service-worker suspension/restart; independent contexts racing `storage.local.get`/`set`; HTTP 409 client reconciliation; crash/power-loss durability. These checks prevent the reproduced stale-response path, not every possible revocation race.

## Next falsification

Pause command execution after an asynchronous local approval or preferences read, revoke pairing before the actual mutation, and test whether a second guard inside the action path is required. Preserve negative outcomes. Do not auto-merge.
