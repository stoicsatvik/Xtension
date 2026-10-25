# E234: Durable retirement and lease fencing do not by themselves make receipt pruning safe

Date: 2026-10-25. Draft research branch stacked on E233 PR #26. No production protocol change.

## Falsifiable question

Suppose the E233 in-memory completion record is replaced with an ideal durable command tombstone, and each command lease has a monotonically increasing epoch. Does this make it safe for the browser to delete its local replay receipt after an acknowledgement?

**No.** The proposed protocol still has two distinct unsafe windows: (1) a lease delivered before retirement can be executed after receipt deletion; (2) a preflight lease check can succeed before retirement, followed by a browser write after retirement (time-of-check/time-of-use, TOCTOU).

## Disposable implementation

`research/e234_retirement_epoch_model.mjs` implements an isolated, deterministic server protocol over an externally retained Map representing *ideal atomic durable storage*. The model persists a command record, increments its lease epoch when re-leased, rejects acknowledgements from obsolete epochs, and writes a never-expiring tombstone before acknowledging completion. A new server object over the same Map simulates restart. Two injected crash points bracket the ideal tombstone write.

This is an **optimistic abstraction**, not an implementation of filesystem durability. It assumes away partial writes, fsync, network partitions, and malicious clients. The actual Xtension MCP server still uses the in-memory `createBridgeStore` in `mcp/src/state-store.mjs`. The browser journal checks in the tests import the **real** `agent/mcp-command-cache.js` helper.

## Six deterministic controls and counterexamples

1. **Lease fencing positive control:** a late first-lease acknowledgement cannot retire the command after a second lease increments the epoch; the second lease can retire it.
2. **Durability positive control:** a crash after the ideal tombstone commit but before the HTTP response does not permit re-leasing after modeled restart.
3. **Pre-commit crash:** a crash before tombstone commit leaves the command re-leasable; the actual browser `pending` intent classification prevents a second local mutation if its journal remains intact.
4. **NEGATIVE, stale issued lease:** an old lease is already in a browser's possession before retirement. The server's durable tombstone cannot recall it. If the browser deletes its receipt and treats an unknown command ID as new, the same mutation executes twice.
5. **Preflight positive control:** an authorization check made *after* retirement correctly rejects a stale lease.
6. **NEGATIVE, preflight TOCTOU:** authorization succeeds, retirement commits in another context, then the previously authorized browser mutation commits. The online check alone is not an atomic barrier.

The two negative tests assert the **observed violation**, not the desired safety property. Therefore six green tests do **not** prove receipt retirement safe. They preserve two concrete counterexamples and four narrower controls.

## Engineering decision

**Do not automatically prune E232 receipts.** Durable server tombstones and lease epochs are useful for rejecting future deliveries and stale acknowledgements, but cannot retroactively invalidate bytes already delivered to another browser worker. Per-command preflight reduces exposure, but it has a race against an independently committing browser write. An end-to-end safe design would need a protocol that closes that race or a conservative retained browser journal and explicit reconciliation. Timeouts, HTTP 200 responses, and ideal server durability are insufficient by themselves.

## Scope and remaining risks

This is a synchronous deterministic model, not a real Chromium MV3 or HTTP experiment, and it does not establish a solution for browser writes across Chrome contexts. The E226 cross-context atomic revocation invariant remains unresolved. No browser storage, server production logic, live user data, deployed systems, or receipt-pruning behavior was modified. Four npm advisories remain untriaged.

Next: model a crash-consistent browser/server reconciliation protocol with stable client-issued command identities, explicit local pending intent ownership, and lease epoch validation at a controlled action boundary. Attempt to falsify it with independently scheduled browser writes and storage eviction before considering production changes.
