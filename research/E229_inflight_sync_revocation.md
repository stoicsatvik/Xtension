# E229 — In-flight evidence HTTP cancellation after pairing revocation

Date: 2026-10-25 (Asia/Kolkata). Draft PR #22 stacked on E228 PR #21. Tests use disposable Vitest Chrome/fetch mocks, not production extension state or user evidence.

## Falsifiable contract

When a pairing token is rotated or disconnected while an evidence `/v1/sync` HTTP request is in flight, the bridge should signal cancellation of that obsolete request and must **not report the old pairing as connected**. A Chrome storage change from another extension context should trigger the same best-effort cancellation. Updating only `lastError` or other connection metadata must **not** cancel an otherwise valid sync.

An HTTP transport may ignore cancellation. Even in that case, a stale response must not be reported as success or update the active pairing's metadata.

## Preserved counterexample

Test-only commit `70d7b5dfac359ce8b9d75e1ab9de6bf3c206a86f` ran in [red PR CI #40145236601](https://github.com/stoicsatvik/Xtension/actions/runs/40145236601). **Three of four tests failed as predicted**: local rotation, local disconnect, and external rotation did not abort the outstanding request. The metadata-only control passed. These were Vitest assertion failures, not dependency installation failures.

## Correction and validation

Implementation commit `6c0a85fae18148d10eeb798df022834dbb7f4709` adds `AbortController` tracking for evidence syncs. Local configure/disconnect and Chrome storage pairing-change events abort requests authenticated with obsolete tokens. The `syncNow` completion path rechecks current pairing and cancellation before claiming success; abort is treated as a pairing change rather than a generic network error. A subsequent regression commit `f94adbef27908e135d498800b5c1f5cb2630222c` added a fetch mock that deliberately ignores abort, to verify stale-success rejection independently.

[Green implementation PR CI #40145512755](https://github.com/stoicsatvik/Xtension/actions/runs/40145512755) passed **5/5 E229 tests**, **12/12 inherited E223/E226/E227/E228 tests**, and agent syntax. All **15/15** PR workflows on that implementation head succeeded, including earlier persistence and revocation regressions.

## Boundaries and negative evidence

- Aborting a browser fetch is best-effort. It does **not** undo bytes already received by the local MCP server and cannot guarantee that a request was never sent.
- Chrome storage offers no atomic check-and-network-dispatch transaction. The check-to-dispatch race and cross-context storage-commit race remain unresolved.
- The E226 expected-failing in-flight `chrome.storage.local.set` atomic revocation assertion remains an expected failure, not a repaired invariant.
- These are mocked Node/Vitest tests. Real Manifest V3 service-worker termination, browser fetch cancellation semantics, and multi-context timing remain unverified.
- CI dependency installation reported **4 npm audit advisories (1 moderate, 3 critical)** without identifying their reachability. They require separate triage; this change did not update dependencies.

## Next experiment

In a disposable Chromium extension environment, suspend a `/v1/sync` server response, revoke pairing from a separate extension context, and measure whether the request is actually cancelled, whether the local server already received evidence, and whether the old UI receives a stale success. Keep delivered-data and atomic-revocation guarantees separate. No merge, deployment, real browser-state mutation, or external outreach in E229.
