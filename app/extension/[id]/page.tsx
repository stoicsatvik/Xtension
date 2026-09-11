import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Report } from "@/components/report";
import { extractExtensionId } from "@/lib/analyzer";
import { ExtensionFetchError, fetchAndAnalyzeExtension } from "@/lib/fetch-extension";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ id: string }>;
};

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params;
  const validId = extractExtensionId(id);

  if (!validId) {
    return {
      title: "Invalid extension — Xtension",
      robots: { index: false, follow: false },
    };
  }

  return {
    title: `Extension ${validId} capability report — Xtension`,
    description: "A static browser-extension capability report generated from the extension's published Chrome package.",
    alternates: { canonical: `/extension/${validId}` },
    openGraph: {
      title: "Browser extension capability report — Xtension",
      description: "See declared permissions, website access, code signals, and external hosts without executing the extension.",
      type: "website",
    },
  };
}

export default async function ExtensionReportPage({ params }: PageProps) {
  const { id } = await params;
  const validId = extractExtensionId(id);
  if (!validId) notFound();

  try {
    const report = await fetchAndAnalyzeExtension(validId);

    return (
      <main>
        <section className="reportPageIntro">
          <a className="backLink" href="/">← Scan another extension</a>
          <div className="eyebrow">PUBLIC XTENSION REPORT</div>
          <p>
            This page is regenerated from the extension&apos;s currently published package. A future history layer will preserve version-to-version permission changes.
          </p>
        </section>
        <Report report={report} />
      </main>
    );
  } catch (error) {
    const message = error instanceof ExtensionFetchError
      ? error.message
      : error instanceof Error
        ? error.message
        : "Analysis failed.";

    return (
      <main>
        <section className="hero compactHero">
          <a className="backLink" href="/">← Back to scanner</a>
          <div className="eyebrow">REPORT UNAVAILABLE</div>
          <h1>We couldn&apos;t inspect <span>{validId}</span>.</h1>
          <p className="lede">{message}</p>
        </section>
      </main>
    );
  }
}
