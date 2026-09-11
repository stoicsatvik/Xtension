import { NextRequest, NextResponse } from "next/server";
import { analyzePackage, chromeUpdateUrl, extractExtensionId } from "@/lib/analyzer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_PACKAGE_BYTES = 25 * 1024 * 1024;

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { input?: unknown };
    const input = typeof body.input === "string" ? body.input : "";
    const id = extractExtensionId(input);

    if (!id) {
      return NextResponse.json(
        { error: "Paste a valid Chrome Web Store URL or 32-character Chrome extension ID." },
        { status: 400 },
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
      return NextResponse.json(
        { error: `Chrome's update service returned HTTP ${response.status}. The extension may not be publicly downloadable.` },
        { status: 502 },
      );
    }

    const lengthHeader = response.headers.get("content-length");
    if (lengthHeader && Number(lengthHeader) > MAX_PACKAGE_BYTES) {
      return NextResponse.json({ error: "Extension package is too large for the MVP scanner." }, { status: 413 });
    }

    const buffer = await response.arrayBuffer();
    if (buffer.byteLength === 0) {
      return NextResponse.json(
        { error: "Chrome returned an empty package. The listing may be blocked, private, or unavailable." },
        { status: 502 },
      );
    }
    if (buffer.byteLength > MAX_PACKAGE_BYTES) {
      return NextResponse.json({ error: "Extension package is too large for the MVP scanner." }, { status: 413 });
    }

    const report = await analyzePackage(id, new Uint8Array(buffer));
    return NextResponse.json({ report });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Analysis failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
