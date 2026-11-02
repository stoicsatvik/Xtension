/** Bounded CRX response reader. A Content-Length header is advisory, never a memory bound. */
export class BoundedDownloadError extends Error {
  constructor(message: string, public readonly status: 413 | 502) {
    super(message);
    this.name = "BoundedDownloadError";
  }
}

/**
 * Stop reading untrusted HTTP bodies as soon as the byte budget is exceeded.
 * The browser's Response.arrayBuffer() buffers the entire body before callers
 * can inspect its length; an absent or false Content-Length bypasses that gate.
 */
export async function readBoundedResponseBytes(response: Response, maxBytes: number): Promise<Uint8Array> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
    throw new BoundedDownloadError("Invalid download byte budget.", 502);
  }
  const lengthHeader = response.headers.get("content-length");
  if (lengthHeader !== null) {
    const raw = lengthHeader.trim();
    if (!/^[0-9]+$/.test(raw) || !Number.isSafeInteger(Number(raw))) {
      throw new BoundedDownloadError("Invalid extension package Content-Length.", 502);
    }
    if (Number(raw) > maxBytes) {
      throw new BoundedDownloadError("Extension package is too large for the MVP scanner.", 413);
    }
  }
  if (!response.body) {
    throw new BoundedDownloadError("Chrome returned no readable package body.", 502);
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!(value instanceof Uint8Array)) {
        throw new BoundedDownloadError("Non-binary extension package response.", 502);
      }
      if (value.byteLength > maxBytes - total) {
        throw new BoundedDownloadError("Extension package is too large for the MVP scanner.", 413);
      }
      total += value.byteLength;
      chunks.push(value);
    }
    if (total === 0) {
      throw new BoundedDownloadError("Chrome returned an empty package.", 502);
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return bytes;
  } catch (error) {
    // Cancel upstream promptly; never wait indefinitely for a hostile source.
    void reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
}
