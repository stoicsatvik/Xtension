# E226 — Revocation races at approval reads and browser-write commits

Date: 2026-10-25 (Asia/Kolkata). Draft PR #19 stacked on E225 PR #18. Synthetic Chrome/fetch harness only. No production deployment, browser user data, or external outreach.

## Falsifiable invariants

1. A command authenticated under token A must **not recreate a pending destructive-action approval** after A is rotated or disconnected while the approval-store read is suspended.
2. A browser preferences write that has already passed authorization must **not commit after token A is revoked** while `chrome.storage.local.set` itself is suspended.

## Preserved negative results

Test-only commit `5e7f3d74130b14789438fae1c03d813a5779d5fb` triggered [red E226 CI #40132593525](https://github.com/stoicsatvik/Xtension/actions/runs/40132593525).

* Both delayed-approval-read assertions failed as predicted: after token rotation and after disconnect, the obsolete command wrote **one pending approval** (expected zero).
* The still-current approval control passed.
* The preference-commit invariant was also falsified: the delayed `storage.local.set(preferences)` committed after rotation. This assertion is deliberately retained as `it.fails`, rather than misrepresented as a passing safety property.

## Narrow correction

`agent/background-mcp-bridge.js` now passes the active pairing predicate into `checkLocalApproval` and revalidates it immediately after the asynchronous approval read. This blocks the two reproduced stale approval writes before they are scheduled. The code still checks again before executing a command, as introduced in E225.

Implementation commit: `f0bcb34505a392586a48a9cfb7dff413379fea05`.

Targeted [green E226 CI #40132666395](https://github.com/stoicsatvik/Xtension/actions/runs/40132666395): **4/4 test cases** in the new file reported successful, including **one deliberately expected-failing atomicity assertion**. Thus **3 positive cases pass; 1 security property remains known-failing**. Do not interpret this as 4 proven security properties. Inherited workflows are checked independently.

## Unresolved and next experiment

Chrome storage does not offer an atomic transaction spanning credential revocation and an already-started browser write. A guard immediately before `storage.local.set` does not cancel that pending write. Approval writes can likewise race if revocation happens after their new guard but before their storage commit. The extension therefore does **not** provide atomic revocation across contexts.

Next: test an explicit serialized bridge-action/disconnect protocol, while keeping direct external token changes and Chrome service-worker suspension as separate adversarial cases. Require the protocol to preserve local dashboard approvals and to avoid clobbering legitimate writes from a newer pairing. Do not claim full atomic revocation without a cross-context coordination design and real-browser validation.
