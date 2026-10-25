# E231 — Durable intent fence for MCP command crash replay

Date: 2026-10-25 (Asia/Kolkata). Stacked on E230 draft PR #23; no production deployment, merge, live Chrome data, or external outreach.

## Falsifiable contract

For an MCP command with a given ID, canonical payload, and pairing token, **a durable pending intent must exist before the first browser mutation**. If the worker terminates or completion-receipt persistence fails after the mutation, redelivery must not execute the command again. An unresolved pending intent returns a specific manual-reconciliation error. A failed intent write must stop execution before any browser action. Successfully completed commands retain ordinary result replay. The invariant is **at-most-once replay under retained durable storage**, not exactly-once execution.

## Preserved negative result

A test-only branch with the inherited E230 implementation was run in [red CI #40153272957](https://github.com/stoicsatvik/Xtension/actions/runs/40153272957). All **3/3** new crash-window contracts failed as predicted:

1. After a browser preference write, an injected completion-receipt failure left no pending intent (undefined instead of pending).
2. With a simulated intent-write failure, the original bridge still performed the browser mutation because it did not journal before the action.
3. A successful command wrote only one cache record, rather than an intent followed by a completion receipt.

The red run reached Vitest and failed deterministic assertions, not dependency installation. The original behavior had no durable marker to distinguish "not executed" from "executed but receipt lost"; replay could therefore repeat the action.

## Correction

- agent/mcp-command-cache.js distinguishes pending from completed receipts, preserving E230 fingerprint/pairing collision rejection and legacy fail-closed behavior.
- rememberCommandIntent records the command fingerprint with phase "pending" before any side effect. rememberCommandResult replaces it with phase "completed" after the command settles.
- Pending intents are retained under completed-receipt churn. When the journal's capacity is consumed by unresolved intents, new work fails closed rather than evicting an uncertain command.
- agent/background-mcp-bridge.js persists the pending intent after approval/authorization and before dispatch. A failed intent write throws without executing the command. A pending replay returns a manual-reconciliation error, never the prior command's success or a fresh browser action.
- The existing local mutation queue orders journal writes and actions within the same service-worker instance.

## Validation

[Implementation-head CI #40153328657](https://github.com/stoicsatvik/Xtension/actions/runs/40153328657) and expanded [CI #40153352198](https://github.com/stoicsatvik/Xtension/actions/runs/40153352198) both passed. The expanded suite checks **3/3** new crash-window regressions, **7/7** inherited E230 replay identity regressions, **5/5** command-cache unit regressions (including three new pending-retention/capacity tests), and agent syntax. These are disposable Vitest Chrome mocks, not actual MV3 process-kill tests.

## Limits and deliberately unresolved cases

- A pending receipt cannot prove whether the action happened. It **requires manual reconciliation**, even if a crash occurred before any mutation. This sacrifices automatic liveness for replay safety.
- A result cache has finite capacity (100 records). Completed receipts can still age out, and automatic replay safety is not guaranteed after eviction or manual storage deletion.
- Chrome storage may be externally cleared, corrupted, or unavailable; a mocked set resolution is not a proof of physical durability.
- Chrome storage does not offer atomic compare-and-swap across extension contexts. Another writer can overwrite the journal; the E226 cross-context atomic revocation expected-failing assertion remains unresolved.
- A Chrome runtime message may trigger effects outside the extension; no distributed transaction exists between its effects and the local intent record.
- Real MV3 suspension, process termination during storage writes, and multi-context concurrency remain untested.
- Four npm dependency advisories (one moderate, three critical) were reported during CI installation; reachability and remediation remain untriaged.

## Next experiment

Run a real Chromium MV3 worker with a kill barrier after durable intent and after an observable browser mutation, restart the worker, and redeliver the same command. Verify that no duplicate side effect occurs while the journal remains, and separately test external deletion, storage eviction, and concurrent context writes. Treat any failure as a counterexample rather than an expected pass.
