import { NextRequest, NextResponse } from "next/server";
import { ExtensionFetchError, fetchAndAnalyzeExtension } from "@/lib/fetch-extension";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { input?: unknown };
    const input = typeof body.input === "string" ? body.input : "";
    const report = await fetchAndAnalyzeExtension(input);
    return NextResponse.json({ report });
  } catch (error) {
    if (error instanceof ExtensionFetchError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    const message = error instanceof Error ? error.message : "Analysis failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
