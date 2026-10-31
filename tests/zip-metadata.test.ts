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

  it("E437 rejects duplicate central-directory filenames before JSZip collapses them", async () => {
    const original = await fixture();
    const eocd = eocdPosition(original);
    const centralStart = original.readUInt32LE(eocd + 16);
    const entryBytes = 46 + original.readUInt16LE(centralStart + 28) +
      original.readUInt16LE(centralStart + 30) + original.readUInt16LE(centralStart + 32);
    const duplicate = original.subarray(centralStart, centralStart + entryBytes);
    const bytes = Buffer.concat([original.subarray(0, eocd), duplicate, original.subarray(eocd)]);
    const newEocd = eocd + entryBytes;
    bytes.writeUInt16LE(original.readUInt16LE(eocd + 10) + 1, newEocd + 8);
    bytes.writeUInt16LE(original.readUInt16LE(eocd + 10) + 1, newEocd + 10);
    bytes.writeUInt32LE(original.readUInt32LE(eocd + 12) + entryBytes, newEocd + 12);
    expect(() => validateEmptyZipCrc(bytes)).toThrow(/Duplicate ZIP central-directory filename/);
    await expect(analyzePackage(id, bytes)).rejects.toThrow(/Duplicate ZIP central-directory filename/);
  });

  it("E437 rejects a local-header filename conflicting with the central record", async () => {
    const bytes = await fixture();
    const namePos = bytes.indexOf(Buffer.from("manifest.json"));
    expect(namePos).toBeGreaterThan(0);
    bytes[namePos + "manifest.jso".length] = "x".charCodeAt(0);
    expect(() => validateEmptyZipCrc(bytes)).toThrow(/local\/central filename mismatch/);
    await expect(analyzePackage(id, bytes)).rejects.toThrow(/local\/central filename mismatch/);
  });

  it("E437 accepts a ZIP with data-descriptor local headers", async () => {
    const zip = new JSZip();
    zip.file("manifest.json", manifest);
    zip.file("empty.js", "");
    const bytes = Buffer.from(await zip.generateAsync({ type: "uint8array", compression: "DEFLATE", streamFiles: true }));
    expect(() => validateEmptyZipCrc(bytes)).not.toThrow();
    const report = await analyzePackage(id, bytes);
    expect(report.package.jsFilesScanned).toBe(1);
  });
});

describe("E438 ambiguous ZIP pathname preflight", () => {
  async function archiveWithName(name: string): Promise<Buffer> {
    const zip = new JSZip();
    zip.file("manifest.json", manifest);
    zip.file(name, "fixture", { createFolders: false });
    return Buffer.from(await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" }));
  }

  it("rejects a parent traversal that would alias manifest.json after JSZip sanitization", async () => {
    const bytes = await archiveWithName("../manifest.json");
    expect(() => validateEmptyZipCrc(bytes)).toThrow(/Unsafe ZIP central-directory filename/);
    await expect(analyzePackage(id, bytes)).rejects.toThrow(/Unsafe ZIP central-directory filename/);
  });

  it.each(["src/../manifest.json", "./manifest.json", "src/./background.js"])(
    "rejects relative path component %s", async (name) => {
      const bytes = await archiveWithName(name);
      expect(() => validateEmptyZipCrc(bytes)).toThrow(/Unsafe ZIP central-directory filename/);
    },
  );

  it.each(["/absolute.js", "..\\manifest.json", "src//background.js"])(
    "rejects noncanonical separator path %s", async (name) => {
      const bytes = await archiveWithName(name);
      expect(() => validateEmptyZipCrc(bytes)).toThrow(/Unsafe ZIP central-directory filename/);
    },
  );

  it("rejects NUL bytes in raw ZIP filenames before text decoding", async () => {
    const bytes = await archiveWithName("badname.js");
    const name = Buffer.from("badname.js");
    let matches = 0;
    let pos = -1;
    while ((pos = bytes.indexOf(name, pos + 1)) !== -1) {
      bytes[pos + 3] = 0;
      matches += 1;
    }
    expect(matches).toBe(2); // Local and central filenames.
    expect(() => validateEmptyZipCrc(bytes)).toThrow(/Unsafe ZIP central-directory filename/);
  });

  it("preserves valid nested Unicode filenames and dotted basenames", async () => {
    const zip = new JSZip();
    zip.file("manifest.json", manifest);
    zip.file("src/é/🛰️.js", "console.log(1)", { createFolders: false });
    zip.file("src/v1..2.js", "", { createFolders: false });
    const bytes = Buffer.from(await zip.generateAsync({ type: "uint8array" }));
    expect(() => validateEmptyZipCrc(bytes)).not.toThrow();
    const report = await analyzePackage(id, bytes);
    expect(report.package.jsFilesScanned).toBe(2);
  });
});

describe("E439 local/central ZIP metadata agreement", () => {
  function firstEntryOffsets(bytes: Buffer): { local: number; central: number } {
    const eocd = eocdPosition(bytes);
    const central = bytes.readUInt32LE(eocd + 16);
    return { central, local: bytes.readUInt32LE(central + 42) };
  }

  it.each(["flags", "method"] as const)(
    "rejects a conflicting local %s field before JSZip parsing", async (field) => {
      const bytes = await fixture();
      const { local } = firstEntryOffsets(bytes);
      const offset = field === "flags" ? 6 : 8;
      bytes.writeUInt16LE(bytes.readUInt16LE(local + offset) ^ 1, local + offset);
      expect(() => validateEmptyZipCrc(bytes)).toThrow(/flags or compression method mismatch/);
      await expect(analyzePackage(id, bytes)).rejects.toThrow(/flags or compression method mismatch/);
    },
  );

  it("rejects a central compression method conflicting with the local header", async () => {
    const bytes = await fixture();
    const { central } = firstEntryOffsets(bytes);
    bytes.writeUInt16LE(bytes.readUInt16LE(central + 10) ^ 1, central + 10);
    expect(() => validateEmptyZipCrc(bytes)).toThrow(/flags or compression method mismatch/);
  });

  it("rejects a local extra field that extends into the central directory", async () => {
    const bytes = await fixture();
    const { local } = firstEntryOffsets(bytes);
    bytes.writeUInt16LE(0xffff, local + 28);
    expect(() => validateEmptyZipCrc(bytes)).toThrow(/local member data exceeds/);
    await expect(analyzePackage(id, bytes)).rejects.toThrow(/local member data exceeds/);
  });

  it("rejects a central compressed size that extends into the central directory", async () => {
    const bytes = await fixture();
    const { central } = firstEntryOffsets(bytes);
    bytes.writeUInt32LE(bytes.length, central + 20);
    expect(() => validateEmptyZipCrc(bytes)).toThrow(/local member data exceeds/);
  });

  it("preserves valid streaming ZIP data descriptors", async () => {
    const zip = new JSZip();
    zip.file("manifest.json", manifest);
    zip.file("background.js", "console.log(1)");
    const bytes = Buffer.from(await zip.generateAsync({
      type: "uint8array", compression: "DEFLATE", streamFiles: true,
    }));
    expect(() => validateEmptyZipCrc(bytes)).not.toThrow();
    const report = await analyzePackage(id, bytes);
    expect(report.package.jsFilesScanned).toBe(1);
  });
});
