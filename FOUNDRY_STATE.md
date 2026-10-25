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


## E224 revoked long-poll command execution — 2026-10-25

Draft PR #17 is stacked on E223 PR #16. The E223 pairing metadata guard
did not prevent an already-outstanding `/v1/commands` response from
dispatching browser mutations after token rotation or disconnect.
[Preserved red PR CI #40123639239](https://github.com/stoicsatvik/Xtension/actions/runs/40123639239)
failed 2/3 tests: each revoked response mutated local preferences once;
the still-current-pairing control passed.

E224 adds a generation-and-token check immediately after long-poll return,
before each command dispatch, before acknowledgements, and before follow-up
sync. See `research/E224_revoked_poll_command_fence.md` and the scoped CI.
**Not proven:** atomic revocation across asynchronous command execution,
real Chrome worker lifecycle, cross-context storage CAS, or HTTP 409 recovery.
No merge, deployment, real browser state, user data, or external outreach.


## E225 revoked action-boundary falsification — 2026-10-25

Draft PR #18 is stacked on E224 PR #17, not merged. E224's poll-level
revocation checks left a time-of-check/time-of-use race during asynchronous
preference reads. The test-only head `108154557` failed **2/3** checks:
both rotation and disconnect caused one stale preferences mutation after the
pairing was revoked; the still-current pairing control passed.
[Preserved red CI #40128466644](https://github.com/stoicsatvik/Xtension/actions/runs/40128466644).

E225 propagates the pairing/generation predicate into command execution and
revalidates after asynchronous reads, before Chrome preference writes or worker
dispatch. Revoked pre-action commands do not create cached failure receipts.
See `research/E225_revoked_action_boundary.md` for the full experiment,
implementation, and limitations.

**Unresolved:** no atomic transaction covers authorization and browser writes.
A revocation after the final check can still race the asynchronous mutation;
approval records may also be written after disconnect. Next: instrument a
barrier *inside* storage.set and test delayed approval-record writes.
No merge, deployment, real browser data, or external outreach.


## E226 approval resurrection and atomic commit falsification — 2026-10-25

Draft PR #19 is stacked on E225 PR #18 and remains unmerged. Two delayed
approval-read regressions exposed stale writes after token rotation and
disconnect: **2/2 failed as predicted** in test-only [red CI #40132593525](https://github.com/stoicsatvik/Xtension/actions/runs/40132593525).
The narrow correction revalidates pairing after the async approval read;
targeted [E226 CI #40132666395](https://github.com/stoicsatvik/Xtension/actions/runs/40132666395)
passed all 4 test cases, but **one is an explicitly expected-failing
atomicity property**. A `chrome.storage.local.set(preferences)` already in
flight still commits after revocation; this remains unresolved and is not
counted as a fixed security invariant.

Details: `research/E226_revocation_commit_races.md`. Next: prototype
serialized bridge-action/disconnect ordering and separately test cross-context
token changes, approval-store commit barriers, and real Chrome lifecycle.
No merge, deployment, live browser state, or outreach.


## E227 local pairing-transition serialization — 2026-10-25

Draft PR #20 is stacked on E226 PR #19 and remains unmerged.
Controlled browser-storage commit barriers showed that the original local
`mcp:disconnect` and `mcp:configure` handlers could complete while an
already-started MCP preference or approval write remained suspended.
[Red E227 CI #40137236128](https://github.com/stoicsatvik/Xtension/actions/runs/40137236128):
**3/4 tests failed**; the idle-disconnect control passed.

A single in-process queue now orders command actions and local dashboard
approve/deny, configure and disconnect mutations. The four new tests and
inherited E225/E226 checks passed at implementation-head
[CI #40137261301](https://github.com/stoicsatvik/Xtension/actions/runs/40137261301).
See `research/E227_local_revocation_serialization.md` for the exact contract
and preserved negative result. Verify final exact-head CI after documentation.

**Not established:** cross-context atomic revocation, prompt cancellation of
hung browser writes, worker restart safety, or real Chrome behavior. The E226
expected-failing external revocation/commit assertion remains unresolved.
No merge, deployment, real browser changes or outreach.


## E228 stale pairing snapshot export — 2026-10-25

Draft PR #21 is stacked on E227 PR #20, unmerged. A delayed Chrome
evidence snapshot could still be posted to the local MCP bridge with a
revoked token after local rotation or disconnect. Test-only
[red CI #40141449903](https://github.com/stoicsatvik/Xtension/actions/runs/40141449903)
reproduced **2 failures / 1 passing control**.

The narrow correction re-reads the active pairing **after** asynchronous
snapshot collection and **before** starting a new HTTP sync. Obsolete syncs
return `connected: false, reason: "pairing-changed"` without dispatching.
[Green implementation CI #40141465792](https://github.com/stoicsatvik/Xtension/actions/runs/40141465792)
passed **3/3 E228 tests**, **9/9 inherited E223/E226/E227 tests**, and
syntax; **14/14 implementation-head workflows succeeded**.
See `research/E228_stale_pairing_snapshot_sync.md`.

**Unresolved:** last-check-to-fetch race, already-sent HTTP requests,
cross-context atomic revocation, MV3 restart behavior, and the known
E226 expected-failing in-flight storage commit assertion. No merge,
deployment, live browser data, or external outreach.


## E229 in-flight evidence sync cancellation — 2026-10-25

Draft PR #22 stacked on E228 PR #21, unmerged. Three controlled
HTTP-pending experiments demonstrated that local pairing rotation,
local disconnect, and an external Chrome storage pairing-change event
did not abort an obsolete evidence sync. The metadata-only control
passed. [Red CI #40145236601](https://github.com/stoicsatvik/Xtension/actions/runs/40145236601):
**3 failures / 1 passing control**.

The correction tracks in-flight sync requests with `AbortController`,
cancels obsolete requests on pairing transitions, and revalidates
the pairing before reporting a completed request as connected.
An additional test confirms that even an abort-ignoring transport
cannot report stale success.
[Green implementation CI #40145512755](https://github.com/stoicsatvik/Xtension/actions/runs/40145512755):
**5/5 new tests**, **12/12 inherited tests**, syntax, and **15/15**
exact implementation-head workflows succeeded. Full evidence and
limitations: `research/E229_inflight_sync_revocation.md`.

**Not established:** recall of already-delivered HTTP evidence, atomic
cross-context revocation or storage commits, real MV3 lifecycle behavior.
E226's expected-failing atomic storage-commit assertion remains.
Dependency installation also reported four untriaged npm advisories.
No merge, deployment, live user evidence, or external outreach.


## E230 command replay identity — 2026-10-25

Draft PR #23 stacked on E229 PR #22, unmerged. Command results
were cached by ID alone. Reusing an ID with changed payload or a
different pairing silently replayed an old success; legacy unscoped
receipts were equally ambiguous. [Red CI #40149070135](https://github.com/stoicsatvik/Xtension/actions/runs/40149070135):
**3/5 failed as predicted**, 2 controls passed.

The correction hashes canonical command identity and pairing into a
SHA-256 receipt fingerprint (without persisting the bearer token),
fails closed on collisions or legacy unscoped receipts, and retains
idempotent redelivery for identical commands. Expanded
[green CI #40149161949](https://github.com/stoicsatvik/Xtension/actions/runs/40149161949):
**7/7 new regressions**, **8/8 inherited regressions**, and syntax
passed. Full evidence: `research/E230_command_replay_identity.md`.

**Unresolved:** legacy receipts require manual reconciliation; real
service-worker crash between browser mutation and receipt persistence
may duplicate side effects. E226 cross-context atomic storage-commit
revocation remains expected-failing. Four npm advisories remain
untriaged. No merge, deployment, live user data, or outreach.


## E231 crash-window command intent fencing — 2026-10-25

Draft E231 work stacked on E230 PR #23, unmerged. A browser mutation
could commit before its command-result receipt, leaving no durable marker
and permitting a duplicate side effect on redelivery. Test-only
[red CI #40153272957](https://github.com/stoicsatvik/Xtension/actions/runs/40153272957)
failed **3/3** new crash-window contracts as predicted.

The correction writes a pairing-scoped pending intent before the first
browser action; a completed receipt replaces it afterward. Interrupted
intents now require manual reconciliation instead of re-execution.
Pending intents survive completed-receipt cache churn; a full pending
journal blocks new commands rather than evicting uncertain actions.
[Expanded green CI #40153352198](https://github.com/stoicsatvik/Xtension/actions/runs/40153352198)
passed **3/3** E231 regressions, **7/7** inherited E230 replay tests,
**5/5** cache unit tests, and agent syntax. Full negative evidence and
limitations: research/E231_command_crash_intent_fence.md.

**Not established:** real MV3 crash behavior, physical storage durability,
automatic liveness for pending commands, exactly-once semantics, or
cross-context atomicity (E226 remains expected-failing). Completed receipts
can still age out after 100 entries; manual storage deletion defeats
the journal. Four npm advisories remain untriaged. No merge, deployment,
live user data, or external outreach.


## E232 completed receipt eviction safety — 2026-10-25

Draft E232 stacked on E231 PR #24, unmerged. E231 protected pending
intents, but its 100-entry bounded journal still evicted **completed**
fingerprinted receipts. Once an old command ID was forgotten, redelivery
could execute its browser mutation again. Test-only
[red CI #40157231972](https://github.com/stoicsatvik/Xtension/actions/runs/40157231972)
reproduced **2/3 failing contracts** (full-journal rejection and the
101st command's unauthorized extra mutation); one pending-identity
control passed.

The initial correction refuses **new** command intents when all 100
journal slots are occupied, preserving completed replay receipts.
A second [red CI #40157369904](https://github.com/stoicsatvik/Xtension/actions/runs/40157369904)
exposed a bypass: denied actions produced unjournaled failure receipts
that could still evict completed evidence (**1/4 E232 tests failed**).
The completion-receipt path now rejects new fingerprinted receipts at
capacity, and the inherited cache test reflects the stronger invariant.
[Final implementation CI #40157458572](https://github.com/stoicsatvik/Xtension/actions/runs/40157458572)
passed **4/4 E232 regressions**, inherited E230/E231 tests, and agent
syntax. Details: `research/E232_completed_receipt_eviction.md`.

**Tradeoff:** no automatic receipt pruning; after 100 unique commands,
new actions require explicit safe reconciliation. This is bounded
fail-closed replay safety, not exactly-once semantics. External journal
deletion, other-context writes, real MV3 process kills, and E226
cross-context atomic revocation remain unresolved. Four npm advisories
remain untriaged. No merge, deployment, live user data, or outreach.

## E233 acknowledgement-only receipt retirement falsification — 2026-10-25

Draft PR #26 is stacked on E232 PR #25, unmerged. The local MCP server's
`completeCommand` acknowledgement is **not** a safe certificate to delete a
browser receipt: an already-issued second lease for the same command ID can
still arrive, and server completion tombstones are in-memory only, lost when
the store is recreated. The real `createBridgeStore` and browser replay-cache
helpers reproduce both counterexamples without live user data.

[Exact-head test CI #40160791723](https://github.com/stoicsatvik/Xtension/actions/runs/40160791723)
passed **4/4 E233 tests**, including **two explicitly expected-failing
safety properties** (not corrections); inherited E231/E232 controls **7/7**
and syntax checks passed. **20/20 exact-head workflows succeeded** on test
commit `9ac1f56f9120f8093c8e93cb01d8fa5b54c59671`.
See `research/E233_retirement_ack_falsification.md`.

**No production pruning or server retirement protocol implemented.**
E232 still fails closed at 100 identities. A durable retirement ledger,
in-flight lease fencing, real MV3 tests, and E226 cross-context atomic
revocation remain unresolved. Four npm advisories are untriaged. No merge,
deployment, live data access, or external outreach.

## E234 durable retirement and preflight TOCTOU falsification — 2026-10-25

Draft PR #27 stacked on E233 PR #26. An isolated optimistic durable
tombstone and lease-epoch model tests the proposed path toward pruning the
E232 browser replay journal. Four positive controls cover stale lease
acknowledgement rejection, ideal tombstone survival across restart,
pending-intent crash reconciliation using the actual browser cache helper,
and rejection of preflight checks after retirement. Two **negative**
counterexamples show that (a) an already-issued stale lease can still be
executed after the browser deletes its receipt, and (b) a successful
online preflight can race with retirement before an asynchronous browser
write commits. See `research/E234_DURABLE_RETIREMENT_TOCTOU_20261025.md`.

**Decision:** do not enable automatic receipt pruning. Idealized durable
server records and lease epochs alone are insufficient for end-to-end
atomic browser mutation. This is a deterministic model, not actual
filesystem durability, HTTP transport, Chromium MV3 termination, or a
production server implementation. E226 cross-context revocation remains
unresolved; four npm advisories are untriaged. No merge, deployment,
live data, or external outreach.


## E264 browser-action crash recovery indistinguishability — 2026-10-25

Draft research branch `research/e264-crash-reconciliation-20261025` stacks on E234. Two crash cuts (before effect and after effect/before receipt) leave exactly the same durable browser pending-intent and server lease state but differ in committed non-idempotent effect count (0 vs 1). Retrying yields [1,2] effects; skipping or halting yields [0,1]. The idealized effect-boundary atomic dedup control yields [1,1]. Seven deterministic Node tests preserve both negative cases and the control; local Node 22 tests passed 7/7. See `research/E264_CRASH_RECONCILIATION_INDETERMINACY_20261025.md` and the E264 exact-head workflow.

**Claim:** exactly-once automatic recovery without effect-boundary idempotency/atomicity REJECTED in the stated protocol model. Browser lifecycle, Chrome action semantics and production durability NOT YET PROVEN. **Next:** classify real browser actions by idempotency and test disposable-Chrome revision/precondition fences; retain fail-closed pending receipts, do not auto-retry uncertain non-idempotent actions. No production pruning, merge, deployment or user-browser changes.
