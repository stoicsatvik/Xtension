# E223 — Revoked MCP pairing token can be restored by a stale async sync

Date: 2026-10-24. Draft branch stacked on E222 PR #15. No merge or deployment.

## Falsifiable invariant

Once the local browser pairing token changes from A to B, completion of an already in-flight request authenticated with A must never restore A in Chrome local configuration. The same rule applies to error-reporting metadata from an obsolete polling generation. Disabling the bridge must not be undone by late request metadata.

## Negative result

The actual `agent/background-mcp-bridge.js` was imported under a deterministic mocked Chrome storage and fetch runtime. The first `/v1/sync` request using A remained unresolved. A storage event rotated the token to B, whose new sync completed. Finally the A request completed successfully.

On the uncorrected E222 implementation, `syncNow` wrote `{ ...active, lastSyncAt, lastError }`, where `active` was the stale A configuration. The test observed A restored, violating the invariant. Preserved expected-red workflow: https://github.com/stoicsatvik/Xtension/actions/runs/40119557984 at test-only head `78df631b09ff97419b5b2997042c784aa8b19cf9` (1/1 regression failed on the intended assertion).

## Narrow correction

`updateConnectionMetadata(active, metadata)` reloads the current Chrome local configuration after an asynchronous sync or poll error and writes metadata only when the pairing remains enabled with the same token. It preserves current configuration fields rather than copying an obsolete `active` object. Both successful sync and poll-error reporting use this guard.

This is a **best-effort stale-completion guard**, not an atomic compare-and-swap: another storage context can change configuration between the asynchronous read and write. Chrome storage's separate get/set operations do not establish linearizability. No claim is made for live service-worker suspension, old poll responses that carry commands, HTTP 409 reconciliation, or two independent bridge processes.

## Validation

`npx vitest run tests/mcp-bridge-token-rotation-race.test.js` and `node --check agent/background-mcp-bridge.js` are executed in the scoped E223 workflow. Inherited E222 lifecycle and E213–E221 persistence workflows should remain green. Record final exact-head status in the PR after documentation.

No real browser state, live user data, production installation, or external outreach was touched.

## Next experiment

Model an obsolete `/v1/commands` long-poll returning an actionable command after pairing rotation. Require the worker to discard that command before any browser-state mutation. Then test the residual cross-context configuration read/write race under two independent Chrome storage writers.
