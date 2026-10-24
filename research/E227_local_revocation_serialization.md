# E227 — Local pairing transitions versus in-flight browser writes

Date: 2026-10-25 (Asia/Kolkata). Draft PR #20 stacked on E226 PR #19. Disposable Vitest Chrome-storage mocks only; no real extension, user state, merge, deployment or external outreach.

## Falsifiable contract

For pairing transitions **initiated through the current service worker's local `mcp:disconnect` and `mcp:configure` message handlers**, a previously started MCP action must finish its Chrome storage write before the transition is committed or reported complete. In particular:

1. Disconnect must not report `connected: false` while an already-started preference write remains suspended.
2. Disconnect must remove approvals *after* an already-started pending-approval write, rather than letting that write resurrect approval state after disconnect.
3. Local token rotation must not publish token B before a previously started preference write under token A completes.
4. Idle disconnect must still complete normally.

## Preserved negative result

Test-only commits `7a03b1782e3f809fb812fd30358874d5cb6e3109` and `57b357b7670fc47f15dadd9bb9e23c1b61aa0ef9` triggered [red E227 CI #40137236128](https://github.com/stoicsatvik/Xtension/actions/runs/40137236128): **3/4 tests failed**. The original handlers returned disconnect/configure success before the suspended preference or approval write was released. The idle-disconnect control passed. These were application assertions, not an installation or workflow failure.

## Narrow implementation

Commit `55e2df2c0b6ad5f8a148f8939e2781c1b076fd45` adds a single in-process promise queue covering:

- `executeCommandOnceLocked` (including browser mutation, approval-store writes and command-result persistence);
- local `mcp:configure` pairing-state writes;
- local `mcp:disconnect` pairing and approval removal;
- local dashboard approve/deny record updates.

A failed operation does not poison the queue. Local disconnect is **completion-ordered**, not an immediate cancellation: an already-started action can finish before disconnect resolves. This is intentional and must be visible to clients; it is not proof that a revoked action is interrupted.

[Green E227 CI #40137261301](https://github.com/stoicsatvik/Xtension/actions/runs/40137261301) passed the four new tests, inherited E225/E226 tests, and agent syntax validation at the implementation head. Inherited workflows and the final documentation head require separate verification.

## Limitations and next falsification

This queue exists only in one JavaScript service-worker instance. It does **not** serialize direct `chrome.storage.local.set` calls from other contexts, independently restarted workers, or writes already in Chrome's storage subsystem when external revocation occurs. The **E226 known-failing atomic revocation assertion remains expected-failing**. An indefinitely stalled browser operation can also delay a local disconnect indefinitely; do not advertise prompt revocation or production-grade atomicity.

Next: introduce a deterministic external-token-rotation barrier during a suspended preference or approval commit and test whether a cross-context generation/ownership protocol can prevent stale writes without losing legitimate new-pairing updates. Also test real Chrome MV3 worker suspension and action timeouts before any deployment.
