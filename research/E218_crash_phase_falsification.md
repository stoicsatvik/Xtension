# E218: SIGKILL fault injection across Xtension state persistence (2026-10-24)

## Motivation and falsifiable hypothesis

E216 reproduced cross-process stale overwrites. E217 PR #10 introduced fail-closed cross-process locking and full-revision comparison. Its documentation explicitly leaves crash recovery and power-loss durability unproven.

**Hypothesis:** Under a real hard process termination (SIGKILL) immediately after (a) acquiring the lock, (b) writing the temporary file, or (c) renaming the temporary file to the canonical path, the E217 implementation will never produce truncated or silently rolled-back canonical JSON. Subsequent writers must refuse to proceed while the abandoned lock remains. After the dead process is verified, a deliberately supervised cleanup and fresh reload must permit a new write.

## Reproducible experiment

Run:

    node --test mcp/node-tests/experiments/crash-phase-falsification.mjs

Each phase uses a unique temporary HOME and independent Node child processes. The child monkeypatches the built-in node:fs/promises method **in its own process only** and calls SIGKILL after the real underlying filesystem operation returns. The implementation under test remains unchanged.

1. Persist a baseline revision at timestamp 1000.
2. Attempt revision 2000; kill immediately after lock acquisition, temporary-file write, or rename.
3. Assert the child died from SIGKILL and that the abandoned lock still exists.
4. Assert canonical JSON is the complete baseline revision for lock/temp crashes and the complete new revision after rename.
5. Assert exactly one temporary file remains only for the temp-write crash.
6. Attempt revision 3000 from another process; it must be rejected and leave canonical bytes semantically unchanged.
7. After confirming the child is no longer running and examining the canonical/temp artifacts, remove the test lock and temp file manually; restart from disk and verify revision 4000 persists.

**Expected failure interpretation:** A truncated or missing canonical state, automatic lock reclamation, an accepted competing write before supervised cleanup, or an unsuccessful fresh reload falsifies the hypothesis.

## Safety and limitations

- Tests never use the real user's HOME, token, Chrome profile, or live bridge.
- The experiment does **not** test kernel panic, hardware power loss, interrupted directory fsync, Windows file semantics, NFS, or durability of disk caches.
- SIGKILL is injected only *after* the selected awaited operation returns, not at arbitrary intermediate filesystem instructions.
- The recovery sequence is a test simulation, **not** an unattended stale-lock cleanup policy. Never delete a live user's lock without verifying process ownership and file integrity.
- No change is proposed to E217's production persistence algorithm. Existing E216 negative results remain preserved in PR #9.
- Successful recovery reloads the canonical revision; it does not merge concurrent snapshots.

## Results

Pending exact-head CI. Record the passing and failing phases, commit SHA, and workflow links after execution. Keep negative results rather than silently adjusting assertions.

## Next falsification

Introduce explicit generation IDs to eliminate full-revision ABA and separately test true fsync-backed power-loss durability; neither is established by this experiment.
