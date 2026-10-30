import type JSZip from "jszip";

/** Shared uncompressed-byte budget; never treat compressed ZIP size as a memory bound. */
export type InflateBudget = { remainingBytes: number };

/** CRC32 is an accidental-corruption check, not a signature or authenticity proof. */
const CRC32_TABLE = new Uint32Array(256);
for (let i = 0; i < CRC32_TABLE.length; i++) {
  let value = i;
  for (let bit = 0; bit < 8; bit++) {
    value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
  }
  CRC32_TABLE[i] = value >>> 0;
}

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
    let crc = 0xffffffff;
    // JSZip 3.10.x stores the central-directory CRC on loaded members.
    // Do not use loadAsync({ checkCRC32: true }): it inflates every ZIP member
    // before our per-member streaming bounds can apply.
    const expectedCrc = (entry as JSZip.JSZipObject & { _data?: { crc32?: number } })._data?.crc32;
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
      for (const byte of chunk) {
        crc = CRC32_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
      }
      used += chunk.byteLength;
      budget.remainingBytes -= chunk.byteLength;
      chunks.push(chunk);
    });
    stream.on("error", (error: Error) => fail(error));
    stream.on("end", () => {
      if (settled) return;
      settled = true;
      // JSZip represents empty loaded members as an empty promise without
      // central-directory CRC metadata. A zero-byte stream has CRC32 zero.
      // Non-empty members must expose a verifiable checksum.
      if (typeof expectedCrc !== "number" || !Number.isInteger(expectedCrc)) {
        if (used !== 0) {
          reject(new Error(`ZIP member has no verifiable CRC32: ${entry.name}`));
          return;
        }
      } else if (((crc ^ 0xffffffff) >>> 0) !== (expectedCrc >>> 0)) {
        reject(new Error(`ZIP member CRC32 mismatch: ${entry.name}`));
        return;
      }
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
