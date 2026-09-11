# Xtension Agent

The Xtension Agent is the installed Chrome bridge for the Xtension control plane. It is not the entire product.

## What the prototype does

- inventories installed extensions through `chrome.management.getAll()`
- includes enabled and disabled extensions
- records version, install type, API permissions, host permissions, and state
- refreshes inventory when extensions are installed, uninstalled, enabled, or disabled
- renders a local dashboard over the entire extension inventory
- labels access/exposure without calling an extension malicious
- supports a user-triggered **Trial Disable for 7 days** workflow
- supports user-confirmed enable and uninstall actions
- optionally requests `history` access at runtime for local-only workflow relevance evidence
- compares recent browsing URLs against declared host permissions without persisting raw browsing history

## Important limitation

Chrome does not expose a trustworthy public metric for "extension X was actually used N times." Site overlap is therefore labeled as context/opportunity evidence, not execution or usage.

The strongest relevance evidence comes from counterfactual trials: if an extension is disabled and the user quickly needs to restore it, it matters. If a trial completes without the workflow needing it, removal becomes a stronger recommendation.

## Load the prototype locally

1. Clone this repository.
2. Open `chrome://extensions`.
3. Enable **Developer mode**.
4. Choose **Load unpacked**.
5. Select the repository's `agent/` directory.
6. Accept the `management` permission warning.
7. Click the Xtension toolbar action to open the dashboard.

Workflow relevance remains off until the user explicitly enables it from the dashboard and grants the optional history permission.

## Privacy posture

- installed-extension inventory is stored in `chrome.storage.local`
- raw browsing history is not persisted by Xtension
- browsing history is not sent to the web analysis backend
- no extension is silently disabled or uninstalled
- user gestures drive management actions

## Next engineering steps

1. Connect each installed ID/version to the existing Xtension CRX analysis API.
2. Cache analysis summaries locally so the dashboard shows package-level evidence too.
3. Persist version snapshots and permission diffs.
4. Add trial-expiry handling and explicit trial outcomes.
5. Add redundancy/category analysis without overclaiming semantic equivalence.
6. Package and sign the agent for Chrome Web Store distribution once permission rationale and privacy UX are mature.
