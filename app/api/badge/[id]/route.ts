import { ExtensionFetchError, fetchAndAnalyzeExtension } from "@/lib/fetch-extension";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }>;
};

function badgeSvg(message: string, tone: "quiet" | "attention" | "broad" = "quiet") {
  const rightWidth = Math.max(92, Math.min(220, message.length * 7 + 24));
  const totalWidth = 86 + rightWidth;
  const fill = tone === "attention" ? "#b83a3a" : tone === "broad" ? "#9a5b16" : "#39414d";
  const escaped = message
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${totalWidth}" height="20" role="img" aria-label="Xtension: ${escaped}">
  <linearGradient id="s" x2="0" y2="100%"><stop offset="0" stop-color="#fff" stop-opacity=".08"/><stop offset="1" stop-opacity=".08"/></linearGradient>
  <clipPath id="r"><rect width="${totalWidth}" height="20" rx="3" fill="#fff"/></clipPath>
  <g clip-path="url(#r)">
    <rect width="86" height="20" fill="#15181d"/>
    <rect x="86" width="${rightWidth}" height="20" fill="${fill}"/>
    <rect width="${totalWidth}" height="20" fill="url(#s)"/>
  </g>
  <g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="11">
    <text x="43" y="15" fill="#010101" fill-opacity=".3">Xtension</text>
    <text x="43" y="14">Xtension</text>
    <text x="${86 + rightWidth / 2}" y="15" fill="#010101" fill-opacity=".3">${escaped}</text>
    <text x="${86 + rightWidth / 2}" y="14">${escaped}</text>
  </g>
</svg>`;
}

export async function GET(_request: Request, { params }: RouteContext) {
  try {
    const { id } = await params;
    const report = await fetchAndAnalyzeExtension(id);
    const highCount = report.capabilities.filter((item) => item.severity === "high").length;
    const allPatterns = [...report.hostPermissions, ...report.contentScriptMatches];
    const broadAccess = allPatterns.some(
      (pattern) => pattern === "<all_urls>" || pattern.includes("*://*/*"),
    );

    const message = broadAccess
      ? "broad web access"
      : highCount === 0
        ? "0 high capabilities"
        : `${highCount} high ${highCount === 1 ? "capability" : "capabilities"}`;

    return new Response(badgeSvg(message, broadAccess ? "broad" : highCount > 0 ? "attention" : "quiet"), {
      headers: {
        "Content-Type": "image/svg+xml; charset=utf-8",
        "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400",
      },
    });
  } catch (error) {
    const message = error instanceof ExtensionFetchError ? "report unavailable" : "scan error";
    return new Response(badgeSvg(message), {
      status: 200,
      headers: {
        "Content-Type": "image/svg+xml; charset=utf-8",
        "Cache-Control": "public, s-maxage=300",
      },
    });
  }
}
