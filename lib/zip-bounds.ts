import type JSZip from "jszip";

/** Shared uncompressed-byte budget; never treat compressed ZIP size as a memory bound. */
export type InflateBudget = { remainingBytes: number };

interface BoundedStream {
  pause(): void;
  resume(): void;
  on(event: string, callback: (payload: any) => void): BoundedStream;
}

/**
 * Read an untrusted ZIP member with an enforced uncompressed byte ceiling.
 * JSZipObject.async('text') inflates the entire entry before callers can slice it.
 * Here the stream is paused and rejected as soon as a chunk exceeds either bound.
 * No JavaScript inside the archive is executed.
 */
export function readBoundedZipText(
  entry: JSZip.JSZipObject,
  perEntryBytes: number,
  budget: InflateBudget,
): Promise<string> {
  if (!Number.isSafeInteger(perEntryBytes) || perEntryBytes < 0 ||
      !Number.isSafeInteger(budget.remainingBytes) || budget.remainingBytes < 0) {
    return Promise.reject(new Error("Invalid ZIP inflation budget."));
  }
  return new Promise((resolve, reject) => {
    const chunks: Uint8Array[] = [];
    let used = 0;
    let settled = false;
    const stream = (entry as JSZip.JSZipObject & { internalStream(type: string): BoundedStream }).internalStream("uint8array");
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      stream.pause();
      reject(error);
    };
    stream.on("data", (chunk: Uint8Array) => {
      if (settled) return;
      if (chunk.byteLength > perEntryBytes - used || chunk.byteLength > budget.remainingBytes) {
        fail(new Error(`ZIP member exceeds uncompressed-byte limit: ${entry.name}`));
        return;
      }
      used += chunk.byteLength;
      budget.remainingBytes -= chunk.byteLength;
      chunks.push(chunk);
    });
    stream.on("error", (error: Error) => fail(error));
    stream.on("end", () => {
      if (settled) return;
      settled = true;
      const bytes = new Uint8Array(used);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
      }
      try {
        resolve(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
      } catch (error) {
        reject(error);
      }
    });
    stream.resume();
  });
}
