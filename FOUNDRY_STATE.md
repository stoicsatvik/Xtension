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
