# Xtension — Product Architecture

Xtension is not primarily a browser-extension scanner. It is a local-first control plane for the extensions installed in a user's browser.

The installed Chrome component is an **agent/bridge**. The product is the dashboard, analysis engine, history layer, and recommendations built on top of it.

## Core promise

> Know every extension you have, what it can access, whether it is enabled, how relevant it appears to your actual browsing workflow, what changed over time, and what action you should take.

## System

```text
Chrome
  |
  | chrome.management.getAll()
  | install/enable/disable/uninstall events
  | optional local browsing-history signals
  v
Xtension Agent (installed Chrome component)
  |
  +--> Local inventory snapshots
  +--> Local relevance engine
  +--> User actions: trial-disable / re-enable / uninstall
  |
  +--> Xtension analysis backend
          |
          +--> CRX manifest analysis
          +--> static code signals
          +--> permission/capability history
          +--> version diffs
          v
      Dashboard
```

## Installed inventory

The agent uses Chrome's `management` API to inventory extensions and preserve fields such as:

- id
- name
- version
- enabled / disabled
- disabled reason
- install type
- permissions
- host permissions
- type
- options URL
- whether the user may disable it

Disabled extensions remain visible in the inventory.

The agent should subscribe to installation, uninstallation, enable, and disable events and snapshot changes over time.

## Relevance is not the same as usage

Chrome does not expose a trustworthy public API saying "the user used extension X 17 times this week." Xtension must not invent this number.

Instead, relevance is evidence-based and decomposed into signals.

### Strong signals

- user marks extension as essential / useful / unnecessary
- extension is explicitly re-enabled during a trial-disable period
- user aborts a trial because a workflow breaks
- user opens the extension's own options/dashboard when observable

### Context signals

With explicit opt-in, Xtension may request Chrome history access and calculate **locally** how often the user visits origins that overlap an extension's host permissions.

This is an *opportunity/relevance* signal, not proof the extension executed.

Raw browsing history should not leave the device. Only local aggregates should be used for recommendations unless the user explicitly exports them.

### Weak signals

- extension has been disabled for a long period
- extension has narrow host access that does not overlap the user's recent browsing
- extension duplicates another installed extension's apparent category/capabilities
- extension has high access but little evidence of relevance

## Relevance model

Do not collapse everything into a fake precision score too early. Preserve the evidence.

A future ranking can use something like:

```text
relevance =
    user_confirmation
  + workflow_dependency
  + site_overlap
  + recency_evidence
  - redundancy
  - long_disabled_penalty
```

And separately:

```text
exposure =
    permission_sensitivity
  + host_breadth
  + static_network_surface
  + capability_changes
```

Then surface the useful decision quadrant:

```text
                    HIGH RELEVANCE
                         |
      KEEP / REVIEW      |      KEEP
                         |
HIGH EXPOSURE ------------+------------ LOW EXPOSURE
                         |
      REMOVE / TEST      |      OPTIONAL
                         |
                    LOW RELEVANCE
```

The product should explain *why* an extension is placed in a quadrant.

## Counterfactual workflow test: Trial Disable

This is one of Xtension's strongest features because it measures dependency instead of pretending to know usage.

For an extension that appears low-relevance:

1. User clicks **Trial disable for 7 days**.
2. Xtension disables it through Chrome's management API after the required user gesture/confirmation.
3. Xtension records the trial locally.
4. The dashboard keeps a one-click **Re-enable** action.
5. If the user re-enables it early, that is strong evidence the extension matters.
6. If the trial ends with no need to restore it, Xtension recommends uninstalling it.

Never auto-uninstall or silently disable extensions.

## Dashboard

### Overview

- total installed
- enabled
- disabled
- high-access extensions
- extensions with capability changes
- trial-disabled extensions
- likely review candidates

### Inventory table

Each row should show:

```text
Icon | Extension | State | Relevance evidence | Access | Change | Recommendation
```

Filters:

- enabled / disabled
- high host access
- unused/review candidates
- recent permission change
- admin installed
- trial disabled

### Extension detail

One page per installed extension:

- state and install type
- version
- permissions
- website access
- static package signals
- permission warnings
- version/permission history
- relevance evidence
- trial-disable history
- recommended action

## Privacy architecture

Default posture:

- inventory lives locally first
- raw browsing history stays local
- no browsing-history upload is required
- cloud backend receives extension IDs/versions only when analysis is requested
- recommendations must show their evidence
- optional history permission is requested only when the user turns on workflow relevance analysis

## Product modes

### Base mode

Requires only `management` access.

Provides:

- full extension inventory
- enabled/disabled state
- permission/host access
- backend CRX analysis
- permission/version changes
- manual cleanup
- trial-disable workflow

### Workflow mode (optional)

User explicitly grants browser history permission at runtime.

Adds:

- site-overlap relevance evidence
- locally computed browsing-domain frequency
- smarter cleanup recommendations

The UI must clearly state that site overlap does not prove extension execution.

## North-star outcome

Xtension should reduce the browser's extension attack surface and clutter without breaking workflows.

A useful north-star metric is not page views. It is:

```text
unnecessary high-access extensions removed or safely disabled
--------------------------------------------------------------
active users
```

Supporting metrics:

- inventory completion rate
- review recommendations accepted
- trial-disable completion rate
- re-enable rate during trials
- uninstall-after-trial rate
- permission-change alerts acted on
- number of extensions per user over time
