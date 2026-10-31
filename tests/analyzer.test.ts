import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { analyzePackage, extractExtensionId, stripCrxHeader } from "../lib/analyzer";

describe("extension id parsing", () => {
  const id = "abcdefghijklmnopabcdefghijklmnop";

  it("accepts a raw extension id", () => {
    expect(extractExtensionId(id)).toBe(id);
  });

  it("extracts ids from Chrome Web Store URLs", () => {
    expect(extractExtensionId(`https://chromewebstore.google.com/detail/example/${id}`)).toBe(id);
  });

  it("rejects unrelated hosts", () => {
    expect(extractExtensionId(`https://example.com/${id}`)).toBeNull();
  });
});

describe("package analysis", () => {
  it("analyzes a ZIP fixture without executing code", async () => {
    const zip = new JSZip();
    zip.file(
      "manifest.json",
      JSON.stringify({
        name: "Fixture Extension",
        version: "1.2.3",
        manifest_version: 3,
        permissions: ["tabs", "scripting"],
        optional_permissions: ["history"],
        host_permissions: ["<all_urls>"],
      }),
    );
    zip.file(
      "background.js",
      "chrome.tabs.query({}); fetch('https://api.example.com/test');",
    );

    const bytes = await zip.generateAsync({ type: "uint8array" });
    expect(stripCrxHeader(bytes)).toEqual(bytes);

    const report = await analyzePackage("abcdefghijklmnopabcdefghijklmnop", bytes);
    expect(report.name).toBe("Fixture Extension");
    expect(report.permissions).toContain("tabs");
    expect(report.optionalPermissions).toContain("history");
    expect(report.capabilities.some((item) => item.source === "permission:history")).toBe(false);
    expect(report.hostPermissions).toContain("<all_urls>");
    expect(report.capabilities.some((item) => item.source === "host:<all_urls>")).toBe(true);
    expect(report.staticSignals.some((item) => item.label === "Tabs API reference")).toBe(true);
    expect(report.externalHosts).toContain("api.example.com");
  });
});


describe("E449 synthetic CRX2/CRX3 ZIP preflight integration", () => {
  const id = "abcdefghijklmnopabcdefghijklmnop";

  function wrapCrx(version: 2 | 3, zip: Uint8Array): Buffer {
    // These are synthetic wrappers, not signed/authorized real CRX packages.
    const prefix = Buffer.alloc(version === 2 ? 16 : 12);
    prefix.write("Cr24", 0, "ascii");
    prefix.writeUInt32LE(version, 4);
    prefix.writeUInt32LE(version === 2 ? 4 : 7, 8);
    if (version === 2) prefix.writeUInt32LE(3, 12);
    return Buffer.concat([
      prefix, Buffer.from([1, 2, 3, 4, 5, 6, 7]), Buffer.from(zip),
    ]);
  }

  async function packageZip(): Promise<Buffer> {
    const zip = new JSZip();
    zip.file("manifest.json", JSON.stringify({
      name: "Synthetic CRX wrapper", version: "1.0.0", manifest_version: 3,
    }));
    zip.file("empty.js", "");
    zip.file("background.js", "console.log('synthetic')");
    return Buffer.from(await zip.generateAsync({
      type: "uint8array", compression: "STORE",
    }));
  }

  it.each([2, 3] as const)(
    "analyzes a valid ZIP through a synthetic CRX%s wrapper", async (version) => {
      const zip = await packageZip();
      const crx = wrapCrx(version, zip);
      expect(stripCrxHeader(crx)).toEqual(zip);
      const report = await analyzePackage(id, crx);
      expect(report.name).toBe("Synthetic CRX wrapper");
      expect(report.package.jsFilesScanned).toBe(2);
    },
  );

  it.each([2, 3] as const)(
    "rejects an oversized synthetic CRX%s header before ZIP parsing", async (version) => {
      const crx = wrapCrx(version, await packageZip());
      crx.writeUInt32LE(crx.length, 8);
      expect(() => stripCrxHeader(crx)).toThrow(/Malformed CRX[23] header/);
      await expect(analyzePackage(id, crx)).rejects.toThrow(/Malformed CRX[23] header/);
    },
  );

  it.each([2, 3] as const)(
    "rejects corrupt empty-member CRC metadata after synthetic CRX%s stripping", async (version) => {
      const zip = await packageZip();
      const eocd = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
      expect(eocd).toBeGreaterThanOrEqual(0);
      let central = zip.readUInt32LE(eocd + 16);
      let found = false;
      for (let i = 0; i < zip.readUInt16LE(eocd + 10); i++) {
        expect(zip.readUInt32LE(central)).toBe(0x02014b50);
        const nameLength = zip.readUInt16LE(central + 28);
        const name = zip.subarray(central + 46, central + 46 + nameLength).toString("utf8");
        if (name === "empty.js") {
          const local = zip.readUInt32LE(central + 42);
          // Keep E444 local/central consistency intact so this reaches
          // the E436 empty-member CRC gate, not an earlier mismatch gate.
          zip.writeUInt32LE(1, central + 16);
          zip.writeUInt32LE(1, local + 14);
          found = true;
          break;
        }
        central += 46 + nameLength + zip.readUInt16LE(central + 30) +
          zip.readUInt16LE(central + 32);
      }
      expect(found).toBe(true);
      await expect(analyzePackage(id, wrapCrx(version, zip))).rejects.toThrow(
        /ZIP empty member CRC32 mismatch/,
      );
    },
  );
});
