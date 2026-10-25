// E234 disposable protocol model. This is NOT Xtension's production MCP server.
// The supplied Map represents an ideal atomic durable ledger across restarts.
// It does not simulate filesystem corruption, network atomicity, or browser writes.
export function createRetirementEpochModel(durableRecords, clock, leaseMs = 30_000) {
  const read = (id) => durableRecords.get(id);
  const write = (id, record) => durableRecords.set(id, structuredClone(record));

  return {
    enqueue(id) {
      if (read(id)) return false; // Tombstones also prevent ID reuse.
      write(id, { status: "queued", epoch: 0, leaseUntil: 0 });
      return true;
    },
    lease(id) {
      const record = read(id);
      if (!record || record.status !== "queued" || record.leaseUntil > clock.value) return null;
      const next = { ...record, epoch: record.epoch + 1, leaseUntil: clock.value + leaseMs };
      write(id, next);
      return { id, epoch: next.epoch };
    },
    authorize(ticket) {
      const record = read(ticket.id);
      return Boolean(record && record.status === "queued" &&
        record.epoch === ticket.epoch && record.leaseUntil > clock.value);
    },
    acknowledge(ticket, { crashAt } = {}) {
      const record = read(ticket.id);
      if (!record || record.status !== "queued" || record.epoch !== ticket.epoch) return false;
      if (crashAt === "before-commit") throw new Error("simulated crash before durable retirement");
      // An idealized atomic tombstone: never auto-expire or forget this ID.
      write(ticket.id, { status: "retired", epoch: record.epoch + 1, leaseUntil: 0 });
      if (crashAt === "after-commit") throw new Error("simulated crash after durable retirement, before HTTP response");
      return true;
    },
    inspect(id) { return structuredClone(read(id) ?? null); }
  };
}
