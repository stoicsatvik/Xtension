# E225 — Revocation during an asynchronous browser action

Date: 2026-10-25 (Asia/Kolkata). Draft PR #18, stacked on E224 PR #17. No merge, deployment, real Chrome extension, or user data accessed.

## Falsifiable invariant

A command fetched using token A must not write Chrome preferences if pairing rotates to token B or disconnects while an asynchronous preferences read is outstanding. The current-pairing control must still write once and acknowledge.

## Preserved negative result

Test-only commit `108154557e82fa11e165b2218e33ca2e099dc6e6` used a controlled `chrome.storage.local.get(preferences)` barrier. After the E224 poll-level authorization check, the test paused the read, revoked A, then released it.

[Red E225 CI #40128466644](https://github.com/stoicsatvik/Xtension/actions/runs/40128466644): **2/3 tests failed as predicted**. Both rotation and disconnect produced one unauthorized preferences write (expected zero); the current-pairing control passed. This was a real application-invariant failure, not a CI infrastructure failure.

## Narrow correction

The polling generation/pairing predicate is now passed into `executeCommandOnce` and through the command action. The agent checks it after asynchronous approval handling and immediately after reading preferences, before writing. Worker-dispatched actions also check immediately before `sendMessage`. Revoked commands return no result and do not cache a false failure receipt. Preferences are shallow-cloned before modification so an abandoned write does not mutate the object returned by the Chrome storage mock.

Regression: `tests/mcp-bridge-revoked-action-boundary.test.js`; CI: `.github/workflows/e225-revoked-action-boundary.yml`.

## Scope and limitations

The correction narrows the time-of-check/time-of-use window but **does not establish atomic revocation**. Chrome storage has no transaction spanning pairing checks and preference writes or runtime messages. Revocation occurring *after* the final authorization check but *before* the asynchronous `storage.local.set` or worker operation may still permit a mutation. Approval record updates may also race disconnect. This is mocked Chrome/fetch behavior, not a real browser service-worker test.

## Next experiment

Use a controlled barrier inside `chrome.storage.local.set` (after the authorization check, before its commit), then rotate pairing. Establish whether a serialized action/revocation protocol is necessary. Also test whether delayed approval-record writes can recreate pending approvals after disconnect. Do not claim strong atomic revocation until those races are falsified or proven safe.
