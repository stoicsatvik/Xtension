# E264: Browser action / receipt crash-window indistinguishability

## Question

Can stable client-issued IDs, a durable server lease/tombstone, and a durable browser pending-intent record guarantee exactly-once completion of a **non-idempotent** browser action after a crash, without an atomic effect-boundary primitive?

## Scope and assumptions

This is a **disposable deterministic protocol model**, not a production Chrome test or implementation change. It imports the E234 server lease/retirement model and the real Xtension `agent/mcp-command-cache.js` journal helpers. A generic non-idempotent action increments a counter. The browser journal and server state are assumed durably committed and are modeled as ideal atomic records. The browser side effect is not transactionally coupled to either record. No browser extension, external API, or user data is touched.

## Discriminating crash cuts

Both histories first (1) enqueue and lease the **same stable command ID**, then (2) durably write the same `pending` browser intent.

- **History A:** crash immediately before the side effect commits; effect count = 0.
- **History B:** side effect commits, then crash before a completion receipt; effect count = 1.

At restart the browser journal, server record, lease ticket, and `inspectCommandReplay` result are **structurally indistinguishable**. Both report `pending`. A recovery policy observing only those durable records cannot know which history occurred.

| Recovery choice | A: pre-effect crash | B: post-effect crash | Guarantee |
|---|---:|---:|---|
| Retry | 1 effect | **2 effects** | duplicates B |
| Skip | **0 effects** | 1 effect | loses A |
| Halt for reconciliation | **0 effects** | 1 effect | avoids automatic duplicate, sacrifices automatic completion |
| Retry with **atomic effect-boundary deduplication** | 1 effect | 1 effect | exactly once **in the idealized control** |

This is an indistinguishability proof under the stated model, not a statistical result. No deterministic recovery choice based only on the same visible records can guarantee exactly one non-idempotent effect in both histories. Randomized policies cannot guarantee it with probability one either. Stable IDs and server fencing do not change the missing information; the idealized atomic effect-dedup control does.

## Reproduction

```bash
node --test tests/e264-crash-reconciliation.test.mjs
node --check research/e264_crash_reconciliation_model.mjs
```

Seven deterministic tests cover equal observable state, retry duplication, skip loss, fail-closed halt, the three-policy matrix, the atomic-dedup control, and malformed input rejection. Green tests **preserve negative counterexamples**, not proof of production safety.

## Claim state and next experiment

- **REJECTED under the modeled protocol:** exactly-once recovery from durable pending intents plus stable IDs and ideal durable server retirement **without** an effect-boundary atomicity/idempotency contract.
- **SUPPORTED in the idealized model:** an effect-boundary deduplication primitive keyed by stable command ID eliminates the demonstrated duplicate/loss ambiguity.
- **NOT YET PROVEN:** real Chrome Manifest V3 behavior, actual extension storage durability, browser preference write atomicity, external APIs, and any production exactly-once guarantee.

**Decision:** Do not prune receipts, silently replay pending intents, or claim exactly-once. Preserve E232 fail-closed journal limits. Next test: classify each real browser action as intrinsically idempotent, conditionally idempotent, or non-idempotent; use disposable Chrome to test action-boundary precondition/revision fences and cross-context races. For non-idempotent actions without a durable effect token, manual reconciliation remains necessary. No merge, deployment, user browser mutation, or outreach.
