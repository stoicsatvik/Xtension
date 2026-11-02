import { analyzePackage, chromeUpdateUrl, extractExtensionId, type AnalysisReport } from "@/lib/analyzer";
import { BoundedDownloadError, readBoundedResponseBytes } from "@/lib/bounded-download";

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

  let bytes: Uint8Array;
  try {
    // Content-Length can be absent or false. Enforce the bound while reading.
    bytes = await readBoundedResponseBytes(response, MAX_PACKAGE_BYTES);
  } catch (error) {
    if (error instanceof BoundedDownloadError) {
      throw new ExtensionFetchError(error.message, error.status);
    }
    throw new ExtensionFetchError("Chrome package download failed.", 502);
  }

  return analyzePackage(id, bytes);
}
