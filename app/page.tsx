"use client";

import { FormEvent, useState } from "react";
import { Report } from "@/components/report";
import type { AnalysisReport } from "@/lib/analyzer";

export default function Home() {
  const [input, setInput] = useState("");
  const [report, setReport] = useState<AnalysisReport | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function analyze(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");
    setReport(null);

    try {
      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input }),
      });
      const data = (await response.json()) as { report?: AnalysisReport; error?: string };
      if (!response.ok || !data.report) throw new Error(data.error ?? "Analysis failed.");
      setReport(data.report);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Analysis failed.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main>
      <section className="hero">
        <div className="eyebrow">OPEN-SOURCE BROWSER EXTENSION X-RAY</div>
        <h1>Know what an extension can access <span>before you trust it.</span></h1>
        <p className="lede">
          Paste a Chrome Web Store URL. Xtension reads the published package, translates its permissions,
          and surfaces notable code references without executing the extension.
        </p>

        <form onSubmit={analyze} className="scanner">
          <input
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder="Chrome Web Store URL or extension ID"
            aria-label="Chrome extension URL or ID"
          />
          <button disabled={loading || !input.trim()}>{loading ? "Scanning…" : "Scan extension"}</button>
        </form>
        <p className="microcopy">Capabilities ≠ malicious behavior. Xtension reports evidence, not accusations.</p>
        {error && <div className="error">{error}</div>}
      </section>

      {!report && (
        <section className="principles">
          <article>
            <span>01</span>
            <h2>Declared access</h2>
            <p>Required permissions, optional permissions, host patterns, and content-script scope are kept distinct.</p>
          </article>
          <article>
            <span>02</span>
            <h2>Static signals</h2>
            <p>References to sensitive browser APIs, network calls, WebSockets, and external endpoints.</p>
          </article>
          <article>
            <span>03</span>
            <h2>No execution</h2>
            <p>The MVP inspects package contents statically. It does not run untrusted extension code.</p>
          </article>
        </section>
      )}

      {report && <Report report={report} shareable />}
    </main>
  );
}
