# E230 — Command replay identity and pairing isolation

Date: 2026-10-25 (Asia/Kolkata). Draft PR #23 stacked on E229 PR #22. All experiments use disposable Vitest Chrome mocks, not live extension state or real user data.

## Falsifiable contract

A persisted MCP command result may be replayed only when the command ID, type, canonical JSON payload, and pairing token are identical. A reused ID with changed payload or pairing must fail closed without mutating Chrome state or reporting the old command's success. A pre-E230 receipt without a replay identity must also fail closed, because it is impossible to prove whether replay or re-execution is safe. Legitimate identical redelivery must still avoid duplicate side effects. Raw bearer tokens must never be persisted in command receipts.

## Preserved counterexamples

Test-only commit `4bc104e7b10cbf3112a3ae6df1bda017238e6c14` ran in [red CI #40149070135](https://github.com/stoicsatvik/Xtension/actions/runs/40149070135). **Three of five tests failed as predicted**: the existing cache returned an old `ok: true` receipt when (1) the command payload changed, (2) the pairing token changed, or (3) the receipt had no scoped identity. Identical redelivery and a distinct new command ID were passing controls. These were deterministic Vitest assertion failures, not installation failures.

## Correction

`agent/mcp-command-cache.js` now distinguishes a missing receipt, an identical replay, a colliding ID, and a legacy unscoped receipt. `agent/background-mcp-bridge.js` canonicalizes JSON payload key order and computes a SHA-256 replay fingerprint covering command ID, type, payload, and pairing token. The fingerprint is stored with the result, not the bearer token. The polling path supplies the current pairing token to command execution.

On a collision, the bridge returns a specific failed result without executing a browser action or replacing the original receipt. A legacy unscoped receipt returns a manual-reconciliation error; this deliberately sacrifices automatic redelivery to avoid both duplicate destructive actions and false success acknowledgements.

## Validation

[Implementation CI #40149131824](https://github.com/stoicsatvik/Xtension/actions/runs/40149131824) passed the five original E230 tests and inherited replay/consent regressions. Expanded [CI #40149161949](https://github.com/stoicsatvik/Xtension/actions/runs/40149161949) passed **7/7 E230 tests**, **8/8 inherited replay, consent, and revoked-poll tests**, and agent syntax. Added controls verify equivalent JSON key ordering and that the persisted fingerprint contains no raw bearer token. This is mocked test evidence, not proof of all real-world replay scenarios.

## Limitations and negative evidence

- Pre-E230 receipts cannot be authenticated retrospectively. Their automatic replay is intentionally blocked; any pending command using a legacy ID needs reconciliation or a fresh command ID.
- SHA-256 collision resistance is assumed; the test suite checks format and token absence, not cryptographic security.
- The local mutation queue serializes within one service worker only. Cross-context concurrent writes and the E226 expected-failing atomic storage-commit revocation property remain unresolved.
- Real Manifest V3 service-worker restart, storage eviction, and interrupted cache persistence have not been exercised.
- CI dependency installation still reports four npm advisories (one moderate, three critical); reachability and remediation are not established.
- No merge, deployment, production data access, or external outreach occurred.

## Next experiment

Suspend a browser mutation after it commits but before its command receipt persists, then crash/restart the MV3 worker and redeliver the same command. Determine whether the existing result-cache protocol can prevent duplicate side effects without a durable transaction. Record the failure even if it requires redesigning command execution semantics.
