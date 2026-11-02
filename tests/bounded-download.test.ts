import { describe, expect, it } from "vitest";
import { BoundedDownloadError, readBoundedResponseBytes } from "../lib/bounded-download";

function streamed(parts: number[], contentLength?: string) {
  let pulled = 0;
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (pulled >= parts.length) { controller.close(); return; }
      controller.enqueue(new Uint8Array(parts[pulled++]));
    },
    cancel() { cancelled = true; },
  }, { highWaterMark: 0 });
  const headers = contentLength === undefined ? {} : { "Content-Length": contentLength };
  return { response: new Response(stream, { headers }), state: () => ({ pulled, cancelled }) };
}

describe("E490 bounded HTTP download", () => {
  it("accepts exactly the byte budget without a length header", async () => {
    const { response } = streamed([3, 4, 3]);
    expect((await readBoundedResponseBytes(response, 10)).byteLength).toBe(10);
  });
  it("rejects over-budget streaming bodies without a length header before full consumption", async () => {
    const { response, state } = streamed([4, 4, 4, 1000]);
    await expect(readBoundedResponseBytes(response, 10)).rejects.toMatchObject({ status: 413 });
    expect(state().pulled).toBe(3);
    expect(state().cancelled).toBe(true);
  });
  it("does not trust a false short length header", async () => {
    const { response } = streamed([5, 6], "1");
    await expect(readBoundedResponseBytes(response, 10)).rejects.toMatchObject({ status: 413 });
  });
  it("rejects declared oversized responses before reading", async () => {
    const { response, state } = streamed([1], "11");
    await expect(readBoundedResponseBytes(response, 10)).rejects.toMatchObject({ status: 413 });
    expect(state().pulled).toBe(0);
  });
  it.each(["NaN", "-1", "1.5", "9007199254740993"])("rejects malformed length %s", async (header) => {
    const { response } = streamed([1], header);
    await expect(readBoundedResponseBytes(response, 10)).rejects.toMatchObject({ status: 502 });
  });
  it("rejects an empty response", async () => {
    const { response } = streamed([]);
    await expect(readBoundedResponseBytes(response, 10)).rejects.toMatchObject({ status: 502 });
  });
  it("rejects an invalid byte budget", async () => {
    const { response } = streamed([1]);
    await expect(readBoundedResponseBytes(response, 0)).rejects.toBeInstanceOf(BoundedDownloadError);
  });
});
