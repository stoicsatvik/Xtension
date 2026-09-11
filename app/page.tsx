"use client";

import { FormEvent, useState } from "react";
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
            <p>Manifest permissions, host patterns, and content-script scope translated into normal language.</p>
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

      {report && <Report report={report} />}
    </main>
  );
}

function Report({ report }: { report: AnalysisReport }) {
  const highCount = report.capabilities.filter((item) => item.severity === "high").length;

  return (
    <section className="report">
      <div className="reportHeader">
        <div>
          <div className="eyebrow">ANALYSIS COMPLETE</div>
          <h2>{report.name}</h2>
          <p>{report.id} · v{report.version} · Manifest V{report.manifestVersion ?? "?"}</p>
        </div>
        <div className={`summaryBadge ${highCount > 0 ? "attention" : "quiet"}`}>
          <strong>{highCount}</strong>
          <span>high-sensitivity capabilities</span>
        </div>
      </div>

      <div className="grid">
        <Panel title="Capabilities">
          {report.capabilities.length === 0 ? (
            <Empty>No mapped high-level capabilities found.</Empty>
          ) : (
            <div className="capabilityList">
              {report.capabilities.map((capability, index) => (
                <article className="capability" key={`${capability.source}-${index}`}>
                  <div className={`severity ${capability.severity}`}>{capability.severity}</div>
                  <div>
                    <h3>{capability.title}</h3>
                    <p>{capability.detail}</p>
                    <code>{capability.source}</code>
                  </div>
                </article>
              ))}
            </div>
          )}
        </Panel>

        <Panel title="Declared permissions">
          <TokenList values={report.permissions} empty="No API permissions declared." />
        </Panel>

        <Panel title="Website access">
          <TokenList values={[...report.hostPermissions, ...report.contentScriptMatches]} empty="No host patterns found." />
        </Panel>

        <Panel title="Static code signals">
          {report.staticSignals.length === 0 ? (
            <Empty>No notable references found in the scanned JavaScript sample.</Empty>
          ) : (
            <div className="signalList">
              {report.staticSignals.map((signal) => (
                <div className="signal" key={signal.label}>
                  <span>{signal.label}</span><strong>{signal.matches}</strong>
                </div>
              ))}
            </div>
          )}
        </Panel>

        <Panel title="External hosts in code">
          <TokenList values={report.externalHosts} empty="No HTTP(S) hosts found in the scanned JavaScript sample." />
        </Panel>

        <Panel title="Package">
          <dl className="facts">
            <div><dt>Compressed package</dt><dd>{formatBytes(report.package.compressedBytes)}</dd></div>
            <div><dt>Files</dt><dd>{report.package.fileCount}</dd></div>
            <div><dt>JS files scanned</dt><dd>{report.package.jsFilesScanned}</dd></div>
          </dl>
        </Panel>
      </div>

      <div className="disclaimer">{report.disclaimer}</div>
    </section>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="panel"><h2>{title}</h2>{children}</section>;
}

function TokenList({ values, empty }: { values: string[]; empty: string }) {
  if (values.length === 0) return <Empty>{empty}</Empty>;
  return <div className="tokens">{values.map((value) => <code key={value}>{value}</code>)}</div>;
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="empty">{children}</p>;
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
