# E455: MCP browser-action replay and status-loop falsification

Date: 2026-10-31. Tier A Xtension. Isolated research branch `research/e455-mcp-command-crash-fence-20261031`. Stacked on draft PR #38; no main changes.

## Source-grounded defects

1. The previous `executeCommandOnce` executed a Chrome management action before persisting its command result. In a fault-injected execution of that **exact existing function** (blob `9ac93f4affdd475f378d051fdb7ddc5939e06470`), the first result persistence failed after the simulated effect. Delivery of the same command ID then executed the simulated effect **twice**. This falsifies an unqualified exactly-once claim across the post-effect/pre-receipt crash window.
2. `syncNow` wrote `lastSyncAt` to the same configuration key whose `chrome.storage.onChanged` handler unconditionally called `startLoop`. A successful sync could therefore start a new sync/long-poll loop. The code-level feedback path is explicit; no live Chrome loop was run.

## Corrective experiment

- Persist a durable `pending` journal receipt **before** attempting any browser action. On restart or delivery of a pending ID, fail closed with an uncertain outcome instead of replaying. After execution, persist a completed receipt before acknowledgment. A failed completion write leaves the pending fence intact.
- Serialize journal transactions within a worker to avoid concurrent duplicate command effects.
- Never evict journal entries automatically; refuse new actions at the declared 5,000-entry capacity. This bounds storage and makes retention limits explicit.
- Preserve legacy cached IDs as `legacy-unverified` pending receipts. Their original payloads were not fingerprinted, so fail closed rather than guessing.
- Restart MCP polling only when enabled state or token changes, not on `lastSyncAt` or `lastError` telemetry.
- Retain Chrome's existing explicit uninstall confirmation; no browser management action was invoked in this research run.

## Validation and limits

Original source fault injection: **2 effects from 1 command ID** after a simulated post-effect persistence failure. New exact committed-source V8 readback checks: **9/9 pass**, including persistence-before-effect, uncertain-outcome non-replay, duplicate concurrent deliveries and status-only restart suppression. Twelve Vitest regression cases were committed but **not executed in native Node/Vitest**; inherited tests, browser integration, and exact-head CI were not run. Source blobs and integration wiring were read back from GitHub.

This provides an at-most-once fence **within retained journal IDs and the modeled storage semantics**, not global exactly-once behavior. A pending command may not have executed; manual reconciliation is required. Browser storage durability, process crashes, multi-context concurrency, token rotation races and bridge queue acknowledgment behavior need integration testing. No external extension was disabled, enabled or uninstalled.

**Claim:** previous crash-window replay safety REJECTED; new fail-closed semantics SUPPORTED IN DETERMINISTIC V8 TESTS; Chrome integration NOT YET VERIFIED.

**Next:** execute native Vitest and a mocked service-worker/bridge crash matrix in free local capacity; test token-rotation and status-update interleavings; do not deploy or enable autonomous browser actions without explicit approval.
