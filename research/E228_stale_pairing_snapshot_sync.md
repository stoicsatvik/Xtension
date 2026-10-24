# E228 — Stale pairing snapshot export after asynchronous evidence collection

Date: 2026-10-25 (Asia/Kolkata). Draft PR #21 stacked on E227 PR #20. Disposable Vitest Chrome mocks only; no real browser data, merge, deployment or external outreach.

## Falsifiable contract

A browser evidence snapshot collected for pairing token A must **not begin a new HTTP sync** authenticated with A if the current pairing was rotated to B or disconnected while the asynchronous Chrome storage snapshot read was pending. An unchanged pairing must still sync.

This is an *initiation-time* authorization boundary, not a claim that an HTTP request already sent can be recalled.

## Preserved negative result

The test-only head `0e666864bb16b614ede07f6ebb3667de2865eda2` triggered [red E228 PR CI #40141449903](https://github.com/stoicsatvik/Xtension/actions/runs/40141449903): **2 of 3 assertions failed**. Both stale-rotation and stale-disconnect cases returned `connected: true` after an old-token sync. The unchanged-pairing control passed. The CI log confirms the failure occurred in Vitest assertions after dependency installation, not in setup.

## Narrow correction

Commit `373acac9efc408dd0cb44f2aeaacb326077e419f` re-reads the currently enabled pairing after `buildSnapshot()` completes and before `bridgeFetch("/v1/sync")` begins. If the pairing is missing or the token differs, `syncNow` returns `{ connected: false, reason: "pairing-changed" }` without issuing the obsolete sync.

[Green E228 PR CI #40141465792](https://github.com/stoicsatvik/Xtension/actions/runs/40141465792): **3/3 new regressions passed**, **9/9 inherited E223/E226/E227 tests passed**, agent syntax passed. All **14/14** workflows associated with the implementation commit completed successfully, including inherited E214–E227 workflows.

## Limitations and next experiment

The check is not a transaction with network dispatch. Pairing can change **after** the final `getConfig()` but **before** the fetch begins, or while a request is in flight. This correction does not revoke already-sent data, cancel in-flight HTTP requests, solve token ABA, guarantee atomic revocation across Chrome contexts, or repair the known expected-failing E226 storage-commit assertion.

Next: deterministic barrier between the last pairing read and fetch dispatch; investigate an AbortController and an in-process pairing generation to cancel requests when a local pairing transition occurs, while explicitly preserving the cross-context and already-delivered-data limitations. Also validate MV3 worker suspension and real Chrome storage ordering before deployment.
