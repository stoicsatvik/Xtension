import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { analyzePackage } from "../lib/analyzer";
import { readBoundedZipText } from "../lib/zip-bounds";

const extensionId = "abcdefghijklmnopabcdefghijklmnop";
const manifest = JSON.stringify({ name: "CRC fixture", version: "1.0.0", manifest_version: 3 });

async function archive(files: Record<string, string | Uint8Array>): Promise<Buffer> {
  const zip = new JSZip();
  for (const [name, data] of Object.entries(files)) zip.file(name, data);
  return Buffer.from(await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" }));
}

/** Change only the central-directory CRC, leaving the compressed payload intact. */
function corruptCentralCrc(original: Buffer, targetName: string): Buffer {
  const bytes = Buffer.from(original);
  for (let i = 0; i <= bytes.length - 46; i++) {
    if (bytes.readUInt32LE(i) !== 0x02014b50) continue;
    const nameLength = bytes.readUInt16LE(i + 28);
    const extraLength = bytes.readUInt16LE(i + 30);
    const commentLength = bytes.readUInt16LE(i + 32);
    const name = bytes.subarray(i + 46, i + 46 + nameLength).toString("utf8");
    if (name === targetName) {
      bytes.writeUInt32LE((bytes.readUInt32LE(i + 16) ^ 1) >>> 0, i + 16);
      return bytes;
    }
    i += 45 + nameLength + extraLength + commentLength;
  }
  throw new Error("ZIP central-directory entry missing");
}

async function read(bytes: Buffer, name: string, limit = 1_000_000): Promise<string> {
  const zip = await JSZip.loadAsync(bytes);
  const entry = zip.file(name);
  if (!entry) throw new Error("ZIP test member missing");
  return readBoundedZipText(entry, limit, { remainingBytes: limit });
}

describe("E435 streamed ZIP CRC32 validation", () => {
  it("accepts a valid manifest and ordinary package analysis", async () => {
    const bytes = await archive({ "manifest.json": manifest, "background.js": "chrome.tabs.query({});" });
    await expect(read(bytes, "manifest.json")).resolves.toBe(manifest);
    const report = await analyzePackage(extensionId, bytes);
    expect(report.package.jsFilesScanned).toBe(1);
  });

  it("accepts valid empty JavaScript members", async () => {
    const bytes = await archive({ "empty.js": "" });
    await expect(read(bytes, "empty.js")).resolves.toBe("");
  });

  it("accepts valid multibyte UTF-8 members", async () => {
    const value = "café 🛰️".repeat(1000);
    const bytes = await archive({ "unicode.js": value });
    await expect(read(bytes, "unicode.js")).resolves.toBe(value);
  });

  it("rejects a corrupt manifest central-directory CRC", async () => {
    const bytes = corruptCentralCrc(await archive({ "manifest.json": manifest }), "manifest.json");
    await expect(analyzePackage(extensionId, bytes)).rejects.toThrow(/CRC32 mismatch/);
  });

  it("rejects a corrupt JavaScript central-directory CRC", async () => {
    const bytes = corruptCentralCrc(
      await archive({ "manifest.json": manifest, "background.js": "console.log(1)" }),
      "background.js",
    );
    await expect(analyzePackage(extensionId, bytes)).rejects.toThrow(/CRC32 mismatch/);
  });

  it("retains the pre-CRC inflation limit", async () => {
    const bytes = await archive({ "background.js": "A".repeat(2_000_000) });
    await expect(read(bytes, "background.js")).rejects.toThrow(/uncompressed-byte limit/);
  });

  it("rejects invalid UTF-8 even when the CRC matches", async () => {
    const bytes = await archive({ "bad.js": new Uint8Array([0xc3, 0x28]) });
    await expect(read(bytes, "bad.js")).rejects.toThrow(/valid|utf-8/i);
  });
});
