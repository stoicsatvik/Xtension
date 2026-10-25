# E233 — A command-result HTTP acknowledgement is not a safe receipt-retirement certificate

Date: 2026-10-25 (Asia/Kolkata). Draft experiment stacked on E232 PR #25. No production runtime changes, live extension use, deployment, or merge.

## Question and falsifiable contract

Can the browser delete a completed command receipt immediately after the current local MCP server accepts `POST /v1/commands/:id/result` without risking execution of an old command again?

**Required property:** Before deletion, the server must durably guarantee that the command ID will never be re-delivered to any browser worker, including already-issued leases and after server restart. This is stronger than an HTTP 200 for one result submission.

## Actual protocol and negative results

`mcp/src/state-store.mjs` currently keeps commands, leases, completed IDs, and deduplication state **in memory**. `completeCommand` removes the command from the queue, records its ID in an in-memory map, and returns true. `takeCommands` can lease the same ID again after its 30-second lease expires, even if an earlier poller already received it. The second poll response cannot be recalled by a later result acknowledgement. A newly constructed bridge store has no prior completion tombstones.

The E233 deterministic test uses the **actual** `createBridgeStore` and `mcp-command-cache` functions, not an invented queue implementation:

1. A first poller receives command C.
2. Advance the injected clock past its lease and let a second poller receive C.
3. Acknowledge the first result. The second already-delivered copy still exists.
4. With the browser receipt retained, the duplicate is classified `replay`; if a hypothetical prune deletes the receipt, it is classified `missing` and the bridge's execution path would consider it new.
5. Reconstruct the server store: the old command ID is not recognized as completed.

Two explicit `it.fails` assertions encode the **unmet** invariants: acknowledgement eliminates all outstanding copies, and acknowledgement is remembered after store recreation. A green CI run means these failures remain expected, **not** that safe pruning has been proven.

This experiment does **not** show that Xtension currently auto-prunes receipts: E232 intentionally retains them and stops new commands at 100 identities. It demonstrates why adding naive prune-on-ack would be unsafe. A fresh, explicitly requested command with a new ID is a separate semantic operation; this test does not claim that all repeated user requests are bugs.

## Design implications

Do not implement automatic receipt deletion on the basis of the current `{ok:true}` response. A retirement design must account for issued-but-not-consumed leases, stable command IDs across restarts, durable server-side retirement tombstones, and an explicit retirement barrier/epoch before browser deletion. It must also handle crashes before and after each durable write, and external browser-storage writers. A bare timeout or a best-effort cancellation is insufficient proof that another poller lacks a stale copy.

## Boundaries and next experiment

Only deterministic in-process JavaScript model tests are exercised. No real network delays, Chromium MV3 termination, server power loss, durable tombstone implementation, or exactly-once guarantee is established. E226 cross-context storage-commit race remains unresolved.

Next: prototype a **disposable** server-retirement ledger with durable tombstones and a drain/fencing epoch. Inject crashes at every acknowledgement/retirement/prune boundary and verify that stale leased deliveries cannot execute after a receipt is deleted. Keep production pruning disabled until that property is established.

## Verified deterministic execution

[Exact-head E233 workflow #40160791723](https://github.com/stoicsatvik/Xtension/actions/runs/40160791723)
completed successfully on `9ac1f56f9120f8093c8e93cb01d8fa5b54c59671`:
**4/4 E233 tests** (2 direct counterexample/control tests and **2 expected-failing
unmet invariants**), **7/7 inherited E231/E232 controls**, and both syntax
checks passed. **20/20 workflows at that head completed successfully**.
Vitest reports expected-failing tests as passing by design; these do not
establish retirement safety. npm installation again reported four dependency
advisories (one moderate, three critical), not triaged here.
