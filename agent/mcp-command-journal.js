// Fail-closed, durable at-most-once fence for local MCP commands.
// Pending commands are never replayed: their browser side effects may have
// succeeded before a worker crash. No claim of global exactly-once delivery.
export const MCP_COMMAND_JOURNAL_KEY = "xtension.mcp.command-journal.v1";
export const MAX_MCP_COMMAND_JOURNAL_ENTRIES = 5000;

function canonical(value) {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value && typeof value === "object") {
    return "{" + Object.keys(value).sort().map((key) =>
      JSON.stringify(key) + ":" + canonical(value[key])).join(",") + "}";
  }
  return JSON.stringify(value);
}

export function commandFingerprint(command) {
  if (typeof command?.id !== "string" || !/^[!-~]{1,256}$/.test(command.id)) {
    throw new Error("Invalid MCP command ID.");
  }
  if (typeof command.type !== "string" || !command.type) {
    throw new Error("Invalid MCP command type.");
  }
  if (command.payload != null &&
      (typeof command.payload !== "object" || Array.isArray(command.payload))) {
    throw new Error("Invalid MCP command payload.");
  }
  return canonical({ type: command.type, payload: command.payload ?? {} });
}

export function serializeCommandExecutions(handler) {
  let tail = Promise.resolve();
  return (command) => {
    const job = tail.then(() => handler(command));
    tail = job.then(() => undefined, () => undefined);
    return job;
  };
}

export async function executeJournaledCommand(command, io, options = {}) {
  const fingerprint = commandFingerprint(command);
  const records = await io.load();
  if (!Array.isArray(records)) throw new Error("MCP command journal is corrupt; refusing action.");
  const existing = records.find((entry) => entry?.id === command.id);
  if (existing) {
    if (existing.fingerprint === "legacy-unverified") {
      return { ok: false, uncertain: true, error: "Legacy command outcome cannot be fingerprint-verified; no automatic replay." };
    }
    if (existing.fingerprint !== fingerprint) {
      return { ok: false, conflict: true, error: "MCP command ID reused with different payload; action refused." };
    }
    if (existing.status === "completed" && existing.result &&
        typeof existing.result.ok === "boolean") return existing.result;
    return { ok: false, uncertain: true, error: "MCP command outcome uncertain; no automatic replay. Review browser state manually." };
  }
  const limit = options.maxEntries ?? MAX_MCP_COMMAND_JOURNAL_ENTRIES;
  if (records.length >= limit) {
    return { ok: false, blocked: true, error: "MCP command journal is full; refusing new actions rather than forgetting deduplication receipts." };
  }
  const now = options.now ?? Date.now;
  const pending = { id: command.id, fingerprint, status: "pending", startedAt: now() };
  await io.save([...records, pending]); // Persist before any browser effect.
  let result;
  try {
    result = { ok: true, value: await io.execute(command) };
  } catch (error) {
    result = { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
  try {
    await io.save([...records, { ...pending, status: "completed", completedAt: now(), result }]);
  } catch {
    return { ok: false, uncertain: true, error: "MCP completion receipt failed after attempted action; manual reconciliation required." };
  }
  return result;
}
