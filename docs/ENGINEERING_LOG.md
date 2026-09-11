# Xtension Engineering Log

This file is the continuation ledger for autonomous engineering work. It records product decisions, evidence boundaries, changes, unresolved risks, and the next highest-leverage work so future sessions do not rediscover the same conclusions.

## Product invariant

Xtension is a **local-first browser-extension control plane**, not a malware score and not a generic extension scanner.

Primary outcome:

> Reduce unnecessary browser-extension attack surface and clutter without breaking useful workflows.

Hard constraints:

- never fabricate per-extension usage telemetry Chrome does not expose
- capability is not evidence of malicious behavior
- raw browsing history remains local and is optional
- never silently disable, enable, uninstall, or reinstall another extension
- destructive actions require explicit user intent and Chrome confirmation where available
- preserve the evidence behind every recommendation

---

## 2026-09-11 — Architecture inspection

### Observed state

The repository had evolved into two cooperating layers:

1. a Next.js CRX/static-analysis surface for individual public extensions
2. a Manifest V3 local agent that inventories and manages the user's installed extension portfolio

The local agent already supported:

- enabled + disabled extension inventory through `chrome.management`
- local state snapshots and timeline events
- permission and host-access deltas across observations
- optional local-only history overlap as relevance context
- explicit user verdicts and notes
- low-confidence redundancy hints
- reversible disable trials
- alert badges for access changes
- evidence-ranked dashboard decisions
- local evidence export

### Chrome platform research

Current Chrome extension documentation confirms:

- `chrome.management` is the correct API for installed-extension inventory and management
- requesting `management` displays the warning "Manage your apps, extensions, and themes"
- the optional `history` permission displays a broad browsing-history warning, so Xtension must continue requesting it only when the user explicitly enables workflow-relevance mode
- `chrome.alarms` is appropriate for restoring MV3 background work after service-worker suspension and for scheduled trial reconciliation
- Chrome does not expose a trustworthy public API for exact usage counts of arbitrary installed extensions

Conclusion: keep **Trial Disable** and explicit user feedback as stronger dependency evidence than speculative telemetry.

---

## 2026-09-11 — Decision-engine regression coverage

### Problem

The recommendation engine had become important enough that a subtle regression could turn weak evidence into a destructive recommendation. Product logic should be tested like policy code, not treated as decorative frontend JavaScript.

### Change

Expanded `tests/agent-core.test.js` to lock down:

- broad-host exposure classification
- sensitive permission interpretation
- exact and wildcard host matching
- scheme-specific host matching
- broad-access vs actual-use distinction
- explicit verdict precedence
- trial outcome precedence
- long-disabled observation semantics
- conservative redundancy hints
- enabled-only attack-surface accounting
- portfolio summary behavior

### Result

CI passed the expanded test suite, Chrome-agent syntax checks, manifest validation, and production Next.js build.

---

## 2026-09-11 — Reversible cleanup archive

### Problem

Users hesitate to remove extensions because uninstall feels irreversible. That reduces cleanup conversion even when the recommendation is correct.

### Decision

Make cleanup psychologically and operationally reversible without automating reinstall.

### Change

Added a local recovery archive:

- records extension metadata when an uninstall is observed while the dashboard agent is active
- stores only local extension metadata, not browsing history
- keeps the extension ID, name, version, description, permissions, host permissions and Web Store recovery URL
- renders a **Recovery Archive** section
- gives the user an explicit **Open Web Store** recovery path
- lets the user forget the local recovery record
- removes an archive record if the extension is later installed again

### Safety property

Xtension does not reinstall anything. Recovery still requires an explicit Chrome Web Store user action.

### Known limitation

The first implementation's archive listener lives in the dashboard module. An uninstall performed while the dashboard is closed may be recorded in the service-worker timeline but may not enter the recovery archive. Moving archive capture into the service worker is a future hardening task.

---

## 2026-09-11 — Trial evidence calibration

### Problem

A seven-day disable trial can miss monthly or infrequent workflows. Calling every completed trial "high-confidence" would create fake certainty.

### Decision

Evidence strength must scale with the observation window.

### Change

Added duration-aware trial evidence:

- restore during a trial → **high-confidence dependency evidence**
- survived trial < 7 days → low cleanup confidence
- survived trial around 7 days → medium cleanup confidence
- survived trial >= 21 days → high cleanup confidence
- unknown historical trial duration → do not pretend certainty

Added regression tests for short, seven-day and thirty-day trials.

### Product implication

The dashboard can continue offering quick seven-day experiments, but future UX should expose a longer trial option for extensions used on monthly/rare workflows.

---

# Current evidence hierarchy

From strongest to weakest:

1. **Explicit user verdict** — user says essential / optional / unnecessary
2. **Restore during disable trial** — direct counterfactual dependency evidence
3. **Long completed disable trial** — stronger evidence of dispensability, still not proof
4. **Long continuously disabled state observed by Xtension**
5. **Scoped site-overlap / no-overlap context** with explicit history opt-in
6. **Conservative category redundancy hint**
7. **Capability exposure alone** — useful for risk, not usefulness

Exposure and relevance remain separate axes.

---

# Highest-leverage next work

## P0 — Background recovery archive

Move recovery capture from dashboard lifetime into the MV3 service worker so removals are archived even when the dashboard is closed.

Acceptance criteria:

- uninstalls anywhere in Chrome create a local recovery record
- archive survives service-worker suspension
- reinstall removes or marks the recovery record restored
- no automatic reinstall

## P0 — Connect portfolio inventory to package analysis

The local agent knows *which* extensions are installed while the existing Next.js scanner knows how to inspect published CRX packages. Those layers are still mostly disconnected.

Target:

```text
installed extension ID/version
        ↓
optional package analysis request
        ↓
manifest + static signals
        ↓
local cached analysis summary
        ↓
portfolio decision evidence
```

Privacy rule: only extension ID/version needs to leave the device for public-package analysis. Raw browsing history and user notes do not.

Open design question: production analysis origin is not deployed/locked yet. Avoid requesting a broad arbitrary-host permission merely to support an unknown future backend.

## P0 — Trial cadence UX

Expose multiple reversible trial windows, e.g. 7 and 30 days, and explain what confidence each duration can support.

Do not equate a successful seven-day trial with proof an extension is unnecessary.

## P1 — New-install exposure review

A newly installed extension with broad website access or sensitive API permissions should enter the attention queue immediately. Do not label it malicious; explain the capability surface and ask whether the workflow value justifies it.

## P1 — Removed-extension recovery from closed dashboard

Same root issue as background recovery. The current dashboard module gives useful behavior during active sessions but should not be the source of truth for lifecycle events.

## P1 — Package-analysis deployment

Deploy the Next.js analysis surface to a stable HTTPS origin, then connect the local agent without requesting unnecessarily broad host access. Navigation to public reports can remain permissionless; programmatic fetch requires a narrow declared host origin.

## P1 — Permission catalog completeness

Keep expanding Chrome permission interpretation from official docs. Unknown permissions must remain explicitly unknown rather than being assigned guessed sensitivity.

## P2 — Better redundancy evidence

Current category matching is deliberately conservative and low-confidence. Improve it using local feature/capability overlap without uploading user data or claiming semantic equivalence from names alone.

## P2 — Audit-session UX

Turn the ranked queue into a guided five-minute review flow:

- top unresolved extension
- evidence summary
- Essential / Optional / Unnecessary
- Trial 7d / Trial 30d
- keep / revisit later

The goal is completed decisions, not dashboard admiration.

---

# Unresolved risks

### `management` permission trust cost

Xtension's core value requires a powerful Chrome permission and therefore a scary install warning. The product must make the reason legible before installation and keep all management actions user-driven.

### History permission trust cost

The optional history permission warning is broader than Xtension's intended local use. Workflow mode must remain optional and revocable, and the UI should continuously state that raw history is neither persisted nor uploaded.

### False confidence from absence of evidence

No host overlap, disabled state, lack of a trial restore, or category overlap can all be misleading for rarely used extensions. Recommendations must preserve uncertainty.

### Static analysis limits

Code references and declared permissions show capability, not behavior. Minified code, dynamic endpoints and runtime behavior can evade static inspection.

### Chrome Web Store dependency

Recovery URLs assume an extension is or was publicly available in the Chrome Web Store. Sideloaded, enterprise or removed listings need a different recovery story.

### Storage growth

Timeline, alerts, trials, preferences and recovery records are bounded or should be bounded. Continue auditing local-storage growth before adding richer snapshots.

---

# North-star metrics

Primary:

```text
unnecessary high-exposure extensions safely disabled or removed
---------------------------------------------------------------
                         active users
```

Supporting:

- portfolio inventory completion
- number of unreviewed access changes
- high-confidence review decisions completed
- trial start / restore / completion rates
- uninstall-after-trial rate
- recovered/reinstalled extension rate
- enabled high-exposure extensions per user over time
- proportion of recommendations with medium/high evidence confidence

The metric to avoid optimizing: raw dashboard page views. Humans already have enough dashboards to stare at.
