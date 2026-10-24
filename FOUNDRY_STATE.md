# FOUNDRY_STATE — Xtension E173

Updated: 2026-10-23 18:00 IST
Tier: A
Working branch: `foundry/e173-local-mcp-action-consent-20261023`
Draft PR: #4
Exact-head commit: `c24de35062a2328b6e03bb55e25ef9cc260a4e78`
Exact-head GitHub Actions: run 39955113265 — SUCCESS

## Claim boundary

- **SUPPORTED (mocked Chrome software contract):** a remote MCP start-trial command does not invoke the Chrome worker before explicit local-dashboard approval. The approved command is bound to ID, action, extension ID and duration, then consumed before the browser action.
- **SUPPORTED (deterministic unit tests):** expiry, denial, altered payload, duplicate execution, and invalid identifier/duration fail closed.
- **NOT YET PROVEN:** end-to-end behavior in a real Chrome Manifest V3 service worker across suspension/restart, multiple tabs, and concurrent MCP clients.
- **NOT YET PROVEN:** complete crash safety or transactional exactly-once behavior. Consumption before action favors preventing repeated destructive operations at the cost of possibly losing an approved operation on crash.
- **NOT YET PROVEN:** timely approval delivery when the MCP command lease (30 seconds) and client wait (40 seconds) interact. A timed-out client can leave a pending command; the dashboard must show it clearly.
- **REJECTED:** inferring maliciousness from declared permissions or static code references.

## E173 changes

- A pure single-use approval policy for Chrome-state-changing MCP commands.
- Local dashboard approve-once/deny controls with five-minute expiry.
- An unapproved command remains queued; no browser-state action and no false success acknowledgement.
- Denied/expired/modified/consumed approvals receive a failure receipt.
- Explicit approval cannot be issued from a remote MCP client; local dashboard sender identity is checked.
- Disconnect clears pending approval records.
- Mocked Chrome integration regression checks approval, denial, spoofed sender, payload mutation, and idempotent redelivery.

## Evidence

GitHub Actions run 39955113265 completed successfully at the exact head. Tests use mocked Chrome APIs and do **not** demonstrate production browser behavior.

## Next highest-EV experiment

Run an actual unpacked-extension browser test with a disposable extension and a local MCP bridge. Measure pending/approved/denied/expired paths, service-worker suspension, queued-command timeout, replay and two-client concurrency. Preserve failures. Do not disable real user extensions as part of testing.

## Safety

No live browser changes, publication, deployment, main merge, paid API, or outreach performed. This remains a draft PR.

## E214 snapshot aliasing — 2026-10-24

Draft PR #7 is stacked on E213 PR #6 and is **not merged**. E213's ordered
persistence queue did not detach nested input objects or the exposed live
snapshot from queued disk revisions. Two deterministic adversarial tests
confirmed that post-acceptance mutations changed the value later persisted:
**0/2 passed** at red CI run 40080913725. The fix clones the sanitized
accepted state and independently clones each queued revision; E214 **2/2**
and E213 **2/2** passed with syntax validation at green CI run 40080950811.

The result supports only an in-process, mocked-persistence snapshot-isolation
contract. It does not establish cross-process write coordination, durable
fsync, crash recovery, or real Chrome behavior. Full protocol, failures and
limitations: `research/E214_snapshot_revision_aliasing.md`.

**Next:** test two local bridge processes and simulated crashes around
temporary-file rename, without touching live browser extensions. No merge,
deployment, paid action, or outreach.


## E215 corrupted persisted-state recovery gate — 2026-10-24

Stacked draft E215 branch follows PR #7. Real-filesystem subprocess tests
reproduced a silent state reset on corrupt JSON and a non-object JSON root:
**2/4 passed, 2/4 failed** in [red CI 40084706384](https://github.com/stoicsatvik/Xtension/actions/runs/40084706384).
The correction distinguishes legitimate ENOENT initialization from corrupted
or unreadable state and refuses to overwrite damaged canonical bytes.
All tests use disposable HOME directories. Green CI at commit
`2a5cbf7ac66884db351033fa025bc7057165c059`:
[run 40084743463](https://github.com/stoicsatvik/Xtension/actions/runs/40084743463).
The full falsification and limits are in
`research/E215_persisted_state_corruption.md`.

**Unresolved:** two processes may still lose updates, temp-file rename is not
fsync-durable, and no actual browser worker lifecycle was exercised.
Next falsification: two independent writers on one disposable state path,
then crash injection before and after rename. Do not merge/deploy automatically.


## E216 cross-process stale overwrite — 2026-10-24

Draft PR #9 is stacked on E215 PR #8 and remains unmerged. An isolated,
deterministic two-child-process experiment loaded the empty state in a stale
writer, persisted a newer revision (timestamp 2000) from another process,
then released the stale writer (timestamp 1000). The stale writer replaced
the canonical state and discarded the newer preference. The single-writer
control passed, the stale-writer invariant failed: **1/2 experiment tests**.
Existing E213-E215 regressions **8/8 passed**.

[Exact-head E216 workflow 40088829460](https://github.com/stoicsatvik/Xtension/actions/runs/40088829460)
reports SUCCESS **because it explicitly verifies the expected failure**,
not because multi-process safety is fixed. See
`research/E216_cross_process_stale_overwrite.md` for protocol and full
counterexample. No production code was changed, no live state accessed.

**Next:** design a fail-closed writer-ownership or lock-plus-revision protocol,
including crash recovery, stale-lock handling, and two simultaneous writers.
Do not merge this branch as a production correction.


## E219 ABA generation isolation — 2026-10-24

Stacked draft E219 branch follows E218 PR #11. The E217 full-logical-state
CAS failed an A -> B -> A cycle when all three snapshots had the same
timestamp and the first/last payloads were identical. The original stale
process incorrectly wrote after observing the first A. The reproducible
independent-process regression failed as expected in
[red CI 40101305487](https://github.com/stoicsatvik/Xtension/actions/runs/40101305487).

The correction stores a fresh durable UUID generation with every accepted
revision and compares that generation under the cross-process lock. Legacy
files upgrade on first write; invalid generation metadata fails closed.
[Initial green CI 40101347672](https://github.com/stoicsatvik/Xtension/actions/runs/40101347672)
passed the ABA, E217, E218, and E213-E215 regressions before two additional
migration/malformed-generation tests and documentation were added. See
`research/E219_aba_revision_generation.md` for the precise claim and
limitations. The final exact-head CI must be verified separately.

**Unproven:** power-loss durability, hostile on-disk rollback, stale-lock
auto-recovery, real Chrome worker integration. No deployment, merge, or
outreach performed.

## E220 rejected-sync rollback — 2026-10-24

Draft E220 is stacked on E219 PR #12. Rejected persistence previously left
`store.state.snapshot` and `lastSyncAt` showing an uncommitted revision even
after the update promise rejected (HTTP 409 for real CAS conflicts).
[Red CI 40105430042](https://github.com/stoicsatvik/Xtension/actions/runs/40105430042)
reproduced both a first-write and queued-second-write counterexample (1/3
initial tests passed). The correction conditionally restores the most recent
committed revision after a rejected write, without clobbering a newer queued
update. An additional older-failure/newer-success concurrency regression was
added. [Initial green CI 40105480044](https://github.com/stoicsatvik/Xtension/actions/runs/40105480044)
passed the first three cases and inherited E213–E219 regressions; final
exact-head CI must be checked after documentation.

**Remaining limitation:** in-flight snapshots may still be visible before
persistence completes. This is not a fully transactional committed-read
interface or a solution for client-side 409 reconciliation. Full experiment:
`research/E220_rejected_sync_rollback.md`. No merge, deployment, live user
state, or outreach.


## E221 committed-read isolation — 2026-10-24

Draft E221 PR #14 is stacked on E220 PR #13. E220 still published
uncommitted snapshots to MCP readers while writes were pending. The E221
deferred-persistence falsification reproduced three premature-visibility
failures; a fourth command-cache test timed out because tentative acceptance
invalidated cached commands. Preserve [red CI 40110165726](https://github.com/stoicsatvik/Xtension/actions/runs/40110165726).

The correction commits visible snapshots, timestamps, and command-cache
invalidation only after a successful queued persistence operation. An older
E214 test that assumed tentative visibility was updated to mutate the
committed state instead, retaining its isolation assertion. The intermediate
inherited-test failure is preserved in
[CI 40110230845](https://github.com/stoicsatvik/Xtension/actions/runs/40110230845).
Four E221 tests and all seven E214–E220 workflows passed at intermediate
exact-head commit `e22ad4f187db85ac9574e91ce13870a7ba0a93d9`.
Verify final CI after documentation commits.

**Not established:** cross-process linearizable reads, live Chrome integration,
409 reconciliation, fsync durability, automatic stale-lock recovery. Full
protocol: `research/E221_committed_read_isolation.md`.
No merge, deployment, user data changes, or outreach.


## E222 MCP bridge polling-loop lifecycle — 2026-10-24

Draft E222 PR #15 is stacked on E221 PR #14. A successful bridge sync
updated `xtension.mcp.v1.lastSyncAt`, which triggered the storage listener's
unconditional `startLoop()`. That restart called `syncNow()` again,
potentially multiplying polling generations and network traffic.

A bounded Chrome-storage mock importing the actual agent reproduced **six**
sync requests where one was expected at test-only commit `225079a`.
[Red CI #40114641435](https://github.com/stoicsatvik/Xtension/actions/runs/40114641435)
preserves the negative result. An earlier failed CI run was a workflow
configuration error (root lockfile absent), not application evidence.

The fix restarts the loop only for pairing-token or enabled-state changes,
not sync timestamps or error metadata. The regression also checks that token
rotation still causes a new sync. See `research/E222_bridge_loop_lifecycle.md`.
Verify final exact-head CI after documentation.

**Unproven:** real Chrome worker lifecycle, HTTP 409 reconciliation,
cross-process reads, power-loss durability, abandoned-lock recovery.
No merge, deployment, user-data access, or outreach.


## E223 MCP pairing-token stale-completion race — 2026-10-24

Draft E223 branch stacked on E222 PR #15. An in-flight sync authenticated
with revoked token A completed after rotation to B and rewrote the Chrome
local configuration back to A. Deterministic mocked-browser test failed on
the original implementation at `78df631b`: [red CI #40119557984](https://github.com/stoicsatvik/Xtension/actions/runs/40119557984).

A narrow guard now re-reads current pairing state before committing successful
sync or polling-error metadata, discarding obsolete-token updates. See
`research/E223_token_rotation_race.md` and the E223 workflow. **Not proven:**
atomic cross-context compare-and-set, stale command response suppression,
real Chrome worker suspend/resume, or HTTP 409 reconciliation. No merge,
deployment, user-data access, or outreach.
