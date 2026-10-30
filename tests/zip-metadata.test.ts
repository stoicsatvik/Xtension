import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { analyzePackage } from "../lib/analyzer";
import { validateEmptyZipCrc } from "../lib/zip-metadata";

const id = "abcdefghijklmnopabcdefghijklmnop";
const manifest = JSON.stringify({ name: "E436 fixture", version: "1.0.0", manifest_version: 3 });

async function fixture(comment = ""): Promise<Buffer> {
  const zip = new JSZip();
  zip.file("manifest.json", manifest);
  zip.file("empty.js", "");
  zip.file("background.js", "chrome.tabs.query({});");
  return Buffer.from(await zip.generateAsync({ type: "uint8array", compression: "DEFLATE", comment }));
}

function corruptEmptyCrc(bytes: Buffer): Buffer {
  const copy = Buffer.from(bytes);
  for (let pos = 0; pos <= copy.length - 46; pos++) {
    if (copy.readUInt32LE(pos) !== 0x02014b50) continue;
    const nameBytes = copy.readUInt16LE(pos + 28);
    const name = copy.subarray(pos + 46, pos + 46 + nameBytes).toString("utf8");
    if (name === "empty.js") {
      copy.writeUInt32LE(1, pos + 16);
      return copy;
    }
  }
  throw new Error("Missing fixture central-directory entry");
}

function eocdPosition(bytes: Buffer): number {
  const pos = bytes.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (pos < 0) throw new Error("Missing fixture EOCD");
  return pos;
}

describe("E436 zero-length ZIP CRC metadata preflight", () => {
  it("accepts a normal package with a legitimate empty JavaScript file", async () => {
    const bytes = await fixture();
    expect(() => validateEmptyZipCrc(bytes)).not.toThrow();
    const report = await analyzePackage(id, bytes);
    expect(report.package.jsFilesScanned).toBe(2);
  });

  it("reproduces JSZip's empty CRC blind spot and rejects the malformed package", async () => {
    const bytes = corruptEmptyCrc(await fixture());
    const zip = await JSZip.loadAsync(bytes);
    await expect(zip.file("empty.js")!.async("text")).resolves.toBe("");
    expect(() => validateEmptyZipCrc(bytes)).toThrow(/empty member CRC32 mismatch/);
    await expect(analyzePackage(id, bytes)).rejects.toThrow(/empty member CRC32 mismatch/);
  });

  it("accepts valid ZIP comments", async () => {
    const bytes = await fixture("comment");
    expect(() => validateEmptyZipCrc(bytes)).not.toThrow();
  });

  it("accepts a valid empty member with a Unicode filename", async () => {
    const zip = new JSZip();
    zip.file("🛰️.js", "");
    const bytes = Buffer.from(await zip.generateAsync({ type: "uint8array" }));
    expect(() => validateEmptyZipCrc(bytes)).not.toThrow();
  });

  it("rejects a truncated ZIP comment / EOCD", async () => {
    const bytes = await fixture("comment");
    expect(() => validateEmptyZipCrc(bytes.subarray(0, -1))).toThrow(/end-of-central-directory/);
  });

  it("rejects inconsistent central-directory counts", async () => {
    const bytes = await fixture();
    bytes.writeUInt16LE(99, eocdPosition(bytes) + 10);
    expect(() => validateEmptyZipCrc(bytes)).toThrow(/Unsupported split|count mismatch/);
  });

  it("fails closed on unsupported ZIP64 offset metadata", async () => {
    const bytes = await fixture();
    bytes.writeUInt32LE(0xffffffff, eocdPosition(bytes) + 16);
    expect(() => validateEmptyZipCrc(bytes)).toThrow(/ZIP64/);
  });
});
