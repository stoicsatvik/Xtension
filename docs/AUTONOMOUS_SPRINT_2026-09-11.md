# Autonomous Xtension Sprint — 2026-09-11

## Objective

Build Xtension toward the best local-first browser-extension control plane possible. Optimize for extension understanding, relevance assessment, workflow impact, and attack-surface reduction. Preserve privacy and uncertainty. Never invent per-extension usage telemetry and never silently disable, enable, uninstall, or reinstall another extension.

## Architecture inspected

Xtension currently has two complementary surfaces:

1. **Public package intelligence** — Next.js routes fetch public CRX packages, parse manifests, map permissions, inspect JavaScript statically, and expose human/JSON/badge reports.
2. **Local browser control plane** — a Manifest V3 Chrome agent inventories the user's installed extensions and keeps local evidence about state, access, workflow context, trials, decisions, and changes over time.

The highest leverage in this sprint was not adding another scanner feature. It was making the local control plane safer, more longitudinal, and easier to act on.

---

## Work completed

### 1. Expanded recommendation-policy regression tests

The decision engine now has regression coverage for:

- broad host access
- sensitive API permissions
- wildcard and scheme-specific host matching
- the distinction between broad eligibility and actual usage
- explicit user verdict precedence
- restore-during-trial dependency evidence
- completed disable-trial cleanup evidence
- observed long-disabled state
- conservative redundancy hints
- enabled-only attack-surface accounting
- portfolio summaries

Reason: recommendation logic is effectively policy code. A subtle regression can turn weak evidence into an overconfident cleanup recommendation, so it needs tests independent of UI rendering.

### 2. Calibrated Trial Disable evidence by duration

Prior behavior risked treating a completed seven-day trial as conclusive evidence that an extension was unnecessary.

New policy:

- restored during trial → high-confidence dependency evidence
- survived <7 days → low cleanup confidence
- survived ~7 days → medium cleanup confidence
- survived >=21 days → high cleanup confidence
- unknown trial duration → no invented certainty

Why: weekly observation can miss monthly or rare workflows. Absence of need during a short window is evidence, not proof.

### 3. Added 30-day trial option

The dashboard now supplements the existing seven-day experiment with a thirty-day trial option. The longer observation window is explicitly intended for monthly or infrequent workflows.

Both trial lengths remain user-triggered and reversible. Xtension never auto-uninstalls at the end of a trial.

### 4. Added a Recovery Archive

Cleanup friction is partly fear of irreversibility. Xtension now keeps a bounded local record of removed extensions containing only extension metadata such as:

- extension ID
- name / description
- last observed version
- permissions and host permissions
- install metadata
- recovery link to the Chrome Web Store

The dashboard renders this as **Removed, but not forgotten**.

The recovery action only opens the store. Xtension never silently reinstalls anything.

### 5. Moved removal capture into the MV3 background lifecycle

The first recovery implementation listened from the dashboard, which meant an uninstall performed while the dashboard was closed could be missed.

The background entrypoint now loads a lifecycle recovery module before normal inventory reconciliation so removal metadata can be preserved from the last local snapshot even when the dashboard is not open.

The dashboard recovery module was then simplified to presentation/storage observation only, eliminating duplicate lifecycle authority.

### 6. Added a structured MV3 service-worker entrypoint

The manifest now points to `service-worker-entry.js`, which composes background modules in a deliberate order rather than continuing to expand one service-worker monolith.

Current background composition includes:

- removal recovery
- high-exposure new-install review
- bounded local version history
- main inventory / alert / trial service worker

This gives Xtension a modular path for future browser lifecycle intelligence.

### 7. Added high-exposure review for newly installed extensions

A newly installed extension with high capability exposure now enters the local review queue.

Important semantics:

- high access is not a malware verdict
- the alert explains capabilities, not intent
- low-exposure installs are not needlessly interrupted
- there is no automatic disabling

The policy was extracted into a pure module and covered by tests.

### 8. Added guided audit workflow

Created a dedicated guided audit surface so Xtension is not merely another dashboard users admire and ignore.

The audit:

- loads the local extension inventory
- ranks extensions by decision attention
- shows exposure, recommendation, decision confidence, workflow evidence, trial evidence, and conservative overlap hints
- lets the user mark an extension Essential / Optional / Unnecessary
- offers reversible 7-day and 30-day disable trials
- supports Skip without forcing a verdict
- keeps every consequential action explicit

This is the product's conversion layer from information to actual browser hygiene.

### 9. Added bounded local version/access history

Xtension now persists locally observed package-access snapshots when an installed extension materially changes:

- version
- API permissions
- host permissions

Enabled/disabled state changes alone do not pollute version history.

History is bounded per extension and is explicitly local-observation history, not fabricated pre-install history.

The dashboard decorates each extension with recent local access-history observations and shows the deltas between them.

### 10. Hardened CI around browser-extension realities

CI now validates more than the Next.js app:

- Vitest policy tests
- Chrome manifest JSON
- manifest background entrypoint existence
- syntax of all local agent/background modules
- MV3 CSP guard against inline scripts in extension HTML
- Next.js production build

This caught an architectural mistake during the sprint: the first guided-audit dashboard entry used an inline script. MV3 extension CSP makes inline JavaScript inappropriate, so navigation was moved into a dedicated module and CI now prevents regression.

---

## Evidence model after this sprint

Xtension should interpret evidence roughly in this order:

1. explicit user verdict
2. restore during a disable trial
3. long completed disable trial
4. continuously observed disabled state
5. scoped browsing-context overlap/no-overlap with explicit history opt-in
6. conservative functional-overlap hint
7. capability exposure alone

Exposure and relevance are separate dimensions.

A high-exposure extension can be essential. A low-exposure extension can still be useless clutter. The product should never collapse those into one magical number.

---

## Privacy model preserved

- installed-extension inventory remains local-first
- raw browsing history is not persisted by Xtension
- raw browsing history is not sent to the web backend
- history access remains optional and revocable
- version/access history contains extension metadata, not browsing history
- user notes and verdicts remain local
- recovery records remain local
- package-analysis backend should need only public extension ID/version when eventually connected

---

## Important unresolved technical risks

### 1. Package intelligence is still not integrated into portfolio decisions

The local agent knows what is installed. The Next.js scanner knows how to analyze public CRX packages. They need a narrow, privacy-preserving bridge.

Do not request arbitrary/broad host permissions before a stable HTTPS analysis origin exists.

### 2. Vercel deployment was not available through the connected account

The connected Vercel surface returned no teams, so this sprint did not manufacture a deployment claim. A stable production origin remains a prerequisite for clean agent-to-analysis integration.

### 3. Recovery depends on public-store availability

A Chrome Web Store recovery link may not work for sideloaded, enterprise-managed, delisted, or region-restricted extensions. Those need a separate recovery model.

### 4. Static CRX analysis is still static

Manifest permissions and code references indicate capability. They do not prove runtime behavior, collection, exfiltration, or malicious intent.

### 5. Redundancy inference remains intentionally weak

Same-category hints are useful for review ordering but are not enough to say two extensions are substitutes. Avoid turning string/category matching into pretend semantic intelligence.

---

## Highest-leverage next steps

### P0 — Connect local inventory to public CRX intelligence

Once a stable backend origin exists, fetch analysis using only extension ID/version and cache a minimal local summary:

```text
installed extension
      ↓
public package analysis
      ↓
capabilities + static endpoints + manifest evidence
      ↓
local decision evidence
```

Never upload history, notes, or local user judgments as part of this request.

### P0 — End-to-end browser tests

Current CI covers policy and syntax well but not a real Chrome runtime. Add Playwright/Chromium extension-loading tests for:

- inventory
- dashboard boot
- guided audit navigation
- trial start
- permission request/revoke
- recovery archive
- lifecycle history

### P1 — Onboarding permission explanation

The `management` permission is structurally required and scary. Build onboarding that explains exactly why it is needed before Chrome displays the permission warning.

### P1 — Audit session persistence

Persist audit progress so a user can close/reopen the browser without losing the session queue. Decisions already persist; session position does not.

### P1 — Better alert review granularity

Allow access-change alerts to be marked reviewed individually rather than only bulk review.

### P1 — Export version/recovery history

The existing local evidence export should eventually include bounded version history and recovery records, while continuing to exclude raw browsing history.

### P2 — Enterprise/managed extension mode

Use `installType`, `mayDisable`, and policy state to explain which extensions are organization-managed and cannot be modified by the user. Do not frame those as cleanup failures.

---

## North-star

The dashboard itself is not the outcome.

A useful long-run metric remains:

```text
unnecessary high-exposure extensions safely disabled or removed
---------------------------------------------------------------
                         active users
```

Secondary success is fewer unreviewed access changes and more decisions backed by medium/high-quality evidence.

Raw page views would be a charming way to optimize the wrong product.
