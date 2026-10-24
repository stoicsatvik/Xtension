# E222 — MCP bridge polling-loop restart falsification

Date: 2026-10-24. Draft PR #15, stacked on E221 PR #14. No merge or deployment.

## Hypothesis and invariant

The Chrome service worker writes `xtension.mcp.v1.lastSyncAt` on each successful local bridge sync, and writes `lastError` on poll failures. Previously, **every** change to this configuration record triggered `startLoop()`, which itself called `syncNow()`. Thus a successful sync could schedule another sync through its own storage event, spawning additional parked polling generations. The invariant is: metadata-only updates must not restart the loop; a changed pairing token or enabled state must restart it.

## Reproduction

`tests/mcp-bridge-loop-lifecycle.test.js` imports the actual `agent/background-mcp-bridge.js` under a bounded mocked Chrome storage/event runtime. Each `/v1/commands` fetch remains pending so any extra `/v1/sync` request can only arise from storage-driven loop restarts. The mock caps storage events at five to prevent an unbounded test loop.

At the test-only baseline `225079a050480bd8c48752ecd3b8733533eb893b`, the original agent made **six** sync requests where exactly one was expected. The test failed with `expected 6 to be 1` in [red CI #40114641435](https://github.com/stoicsatvik/Xtension/actions/runs/40114641435).

An earlier CI attempt at `5093292400af56247e7f6c196c11d479f794d090` failed before testing because the workflow incorrectly assumed a root npm lockfile existed. This was corrected to match the repository's existing `npm install` CI convention. That setup failure is not evidence of the application defect.

## Correction

The `chrome.storage.onChanged` handler now compares the previous and next MCP configuration's **enabled** and **token** fields. It calls `startLoop()` only when pairing or enablement actually changes. Successful-sync timestamps and poll-error metadata cannot spawn new loop generations.

The regression checks startup sync count, error-metadata updates, and token rotation. It is a mocked service-worker lifecycle test, not a live Chrome test.

## Validation and limitations

Run `npx vitest run tests/mcp-bridge-loop-lifecycle.test.js` and `node --check agent/background-mcp-bridge.js` through `.github/workflows/e222-bridge-loop-lifecycle.yml`. Inherited E213–E221 persistence CI must remain green. Record final exact-head results in the PR after the documentation commit.

This does **not** resolve HTTP 409 client reconciliation, cross-process stale reads, power-loss durability, stale-lock recovery, or worker suspend/resume behavior. The next experiment should test two independent local bridge processes and verify that the browser client retains unsynchronized evidence after HTTP 409, with no automatic blind retry.

No real browser state, live user data, production installation, or external outreach was touched.
