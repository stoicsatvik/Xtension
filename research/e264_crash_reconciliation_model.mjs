// E264 disposable crash-window model. No Chrome APIs or production state.
// This models a generic non-idempotent browser effect whose commit is NOT
// atomic with the extension's durable command-receipt journal.
import { createRetirementEpochModel } from "./e234_retirement_epoch_model.mjs";
import { inspectCommandReplay, rememberCommandIntent } from "../agent/mcp-command-cache.js";

export function crashWorld({ effectCommitted }) {
  if (typeof effectCommitted !== "boolean") throw new TypeError("effectCommitted must be boolean");
  const clock = { value: 1000 };
  const durableServer = new Map();
  const server = createRetirementEpochModel(durableServer, clock);
  server.enqueue("stable-client-id");
  const ticket = server.lease("stable-client-id");
  // Browser writes the intent durably before dispatch. Both crash cuts leave
  // the same journal bytes, ticket, and server durable state.
  const browserJournal = rememberCommandIntent([], ticket.id, "same-pairing-and-payload", clock.value);
  const effects = effectCommitted ? 1 : 0;
  const visible = {
    journal: structuredClone(browserJournal),
    server: server.inspect(ticket.id),
    ticket: structuredClone(ticket),
    replay: inspectCommandReplay(browserJournal, ticket.id, "same-pairing-and-payload").state
  };
  return { visible, effects };
}

export function recover(world, policy, { atomicEffectDedup = false } = {}) {
  if (!["retry", "skip", "halt"].includes(policy)) throw new RangeError("invalid policy");
  const replay = world.visible.replay;
  if (replay !== "pending") throw new Error("fixture must represent uncertain pending intent");
  const existingEffects = world.effects;
  let effects = existingEffects;
  if (policy === "retry") {
    // This flag represents an external operation that atomically deduplicates
    // by command identity AT THE SIDE-EFFECT COMMIT. The ordinary Chrome
    // mutation boundary does not supply this contract.
    if (!atomicEffectDedup || existingEffects === 0) effects += 1;
  }
  return { effects, exactlyOnce: effects === 1, duplicated: effects > 1, lost: effects === 0 };
}

export function crashCutMatrix() {
  const worlds = [crashWorld({ effectCommitted: false }), crashWorld({ effectCommitted: true })];
  return ["retry", "skip", "halt"].map(policy => ({
    policy,
    outcomes: worlds.map(world => recover(world, policy)),
    guaranteesExactlyOnce: worlds.every(world => recover(world, policy).exactlyOnce)
  }));
}
