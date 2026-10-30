import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { analyzePackage } from "../lib/analyzer";
import { readBoundedZipText } from "../lib/zip-bounds";

const id = "abcdefghijklmnopabcdefghijklmnop";
async function archive(files: Record<string, string>): Promise<Uint8Array> {
  const zip = new JSZip();
  for (const [name, value] of Object.entries(files)) zip.file(name, value);
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE", compressionOptions: { level: 9 } });
}
const manifest = JSON.stringify({ name: "Bounded fixture", version: "1.0.0", manifest_version: 3 });

describe("E434 untrusted ZIP inflation bounds", () => {
  it("accepts ordinary small archives without changing analysis", async () => {
    const bytes = await archive({ "manifest.json": manifest, "background.js": "chrome.tabs.query({});" });
    const report = await analyzePackage(id, bytes);
    expect(report.name).toBe("Bounded fixture");
    expect(report.package.jsFilesScanned).toBe(1);
    expect(report.staticSignals.some((signal) => signal.label === "Tabs API reference")).toBe(true);
  });

  it("rejects a tiny compressed package whose JS inflates beyond one megabyte", async () => {
    const bytes = await archive({ "manifest.json": manifest, "background.js": "A".repeat(2_000_000) });
    expect(bytes.byteLength).toBeLessThan(10_000);
    await expect(analyzePackage(id, bytes)).rejects.toThrow(/uncompressed-byte limit/);
  });

  it("rejects a compressed oversized manifest before JSON parsing", async () => {
    const bytes = await archive({ "manifest.json": manifest + " ".repeat(300_000) });
    await expect(analyzePackage(id, bytes)).rejects.toThrow(/uncompressed-byte limit/);
  });

  it("enforces a shared six-megabyte JS budget across individually allowed files", async () => {
    const files: Record<string, string> = { "manifest.json": manifest };
    for (let i = 0; i < 7; i++) files[`script-${i}.js`] = "Z".repeat(900_000);
    const bytes = await archive(files);
    await expect(analyzePackage(id, bytes)).rejects.toThrow(/uncompressed-byte limit/);
  });

  it("rejects invalid budgets and preserves valid UTF-8", async () => {
    const zip = await JSZip.loadAsync(await archive({ "x.js": "café 🛰️" }));
    const entry = zip.file("x.js")!;
    await expect(readBoundedZipText(entry, -1, { remainingBytes: 10 })).rejects.toThrow(/Invalid ZIP/);
    const budget = { remainingBytes: 50 };
    await expect(readBoundedZipText(entry, 50, budget)).resolves.toBe("café 🛰️");
    expect(budget.remainingBytes).toBeLessThan(50);
  });
});
