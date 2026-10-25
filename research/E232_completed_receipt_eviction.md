# E232 — Completed command receipt eviction can re-enable side effects

Date: 2026-10-25 (Asia/Kolkata). Draft experiment stacked on E231 PR #24. No deployment, merge, live Chrome data, or external outreach.

## Falsifiable invariant

For every command accepted through the MCP bridge while its local journal is retained, a subsequent redelivery of that command ID/payload/pairing must not trigger a second browser mutation merely because newer commands filled the bounded receipt cache. When there is no safe journal capacity, reject the **new** command before its first side effect. This is a bounded, fail-closed safety property, not an exactly-once or indefinitely live service.

## Negative evidence preserved

Test-only commit `6f290384c8dd56a39133744672800b3085803ca6` ran [red CI #40157231972](https://github.com/stoicsatvik/Xtension/actions/runs/40157231972). Vitest reached the assertions: **2/3 new tests failed**, one control passed.

1. With two completed fingerprinted receipts in a two-slot journal, `rememberCommandIntent` accepted a third command rather than throwing. The old retention algorithm silently evicted the oldest completed receipt.
2. Through the bridge, after 100 distinct successful `set-verdict` commands, the 101st command **successfully mutated browser preferences** rather than being rejected before the side effect. Its journal write displaced the oldest completed receipt. Subsequent redelivery of the evicted ID would be treated as new work and could mutate again.
3. The control for retaining an existing pending intent at capacity passed.

The red failures were behavioral assertions, not dependency installation errors.

## Correction

`agent/mcp-command-cache.js` now checks journal capacity **before** creating a fresh intent. It refuses new command identities when all 100 slots are occupied, including slots containing completed receipts. Existing pending identities remain fenced; completed identities must be replayed from their retained receipts and cannot be re-journaled as new actions. Identity collisions fail closed. This retains the legacy result-cache helper's historical bounded behavior, but the production bridge's intent-first path no longer silently evicts previously completed replay evidence.

## Tradeoff and limitations

- This deliberately sacrifices liveness: after 100 unique commands the bridge stops accepting new commands until the journal is explicitly and safely reconciled. **No automatic deletion or reset** was added, because clearing receipts could make old server commands execute again.
- This protects only commands accepted through the intent-first bridge path and assumes the journal remains intact. Other writers, storage deletion/eviction, corruption, and cross-context read-modify-write races can still defeat the guarantee.
- Manual reconciliation must verify the remote command queue and local side effects before any retention reset. A safe automated protocol for pruning old receipts is **not** established.
- The earlier E226 cross-context atomic revocation counterexample remains unresolved.
- The test harness uses Vitest Chrome mocks, not real MV3 process-kill behavior.
- Four npm advisories (one moderate, three critical) remain untriaged.

## Validation

The implementation is checked by `tests/mcp-bridge-receipt-retention.test.js`, which exercises the bounded helper, 100 real bridge command calls under mocked Chrome storage, and pending-intent retention. Inherited E230/E231 regression suites and agent syntax are run by `.github/workflows/e232-receipt-retention.yml`.

## Next experiment

Design and falsify a safe receipt-pruning protocol: prove that the server can durably acknowledge a command ID as retired before the browser forgets its receipt, including crashes between server retirement and local pruning. Independently, test cross-context journal lost updates and real MV3 termination. Do not clear the journal automatically until both sides have an agreed retirement invariant.
