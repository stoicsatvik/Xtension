import { analyzePackage, chromeUpdateUrl, extractExtensionId, type AnalysisReport } from "@/lib/analyzer";

const MAX_PACKAGE_BYTES = 25 * 1024 * 1024;

export class ExtensionFetchError extends Error {
  status: number;

  constructor(message: string, status = 500) {
    super(message);
    this.name = "ExtensionFetchError";
    this.status = status;
  }
}

export async function fetchAndAnalyzeExtension(input: string): Promise<AnalysisReport> {
  const id = extractExtensionId(input);
  if (!id) {
    throw new ExtensionFetchError(
      "Paste a valid Chrome Web Store URL or 32-character Chrome extension ID.",
      400,
    );
  }

  const response = await fetch(chromeUpdateUrl(id), {
    redirect: "follow",
    headers: {
      "User-Agent": "Mozilla/5.0 Xtension/0.1",
      Accept: "application/x-chrome-extension,application/octet-stream,*/*",
    },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new ExtensionFetchError(
      `Chrome's update service returned HTTP ${response.status}. The extension may not be publicly downloadable.`,
      502,
    );
  }

  const lengthHeader = response.headers.get("content-length");
  if (lengthHeader && Number(lengthHeader) > MAX_PACKAGE_BYTES) {
    throw new ExtensionFetchError("Extension package is too large for the MVP scanner.", 413);
  }

  const buffer = await response.arrayBuffer();
  if (buffer.byteLength === 0) {
    throw new ExtensionFetchError(
      "Chrome returned an empty package. The listing may be blocked, private, or unavailable.",
      502,
    );
  }
  if (buffer.byteLength > MAX_PACKAGE_BYTES) {
    throw new ExtensionFetchError("Extension package is too large for the MVP scanner.", 413);
  }

  return analyzePackage(id, new Uint8Array(buffer));
}
