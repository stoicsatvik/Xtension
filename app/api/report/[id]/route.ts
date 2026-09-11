import { NextResponse } from "next/server";
import { ExtensionFetchError, fetchAndAnalyzeExtension } from "@/lib/fetch-extension";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(_request: Request, { params }: RouteContext) {
  try {
    const { id } = await params;
    const report = await fetchAndAnalyzeExtension(id);

    return NextResponse.json(
      {
        schemaVersion: 1,
        generatedAt: new Date().toISOString(),
        report,
      },
      {
        headers: {
          "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400",
        },
      },
    );
  } catch (error) {
    if (error instanceof ExtensionFetchError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    const message = error instanceof Error ? error.message : "Analysis failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
