import type { AnalysisReport } from "@/lib/analyzer";

export function Report({ report, shareable = false }: { report: AnalysisReport; shareable?: boolean }) {
  const highCount = report.capabilities.filter((item) => item.severity === "high").length;

  return (
    <section className="report">
      <div className="reportHeader">
        <div>
          <div className="eyebrow">ANALYSIS COMPLETE</div>
          <h2>{report.name}</h2>
          <p>{report.id} · v{report.version} · Manifest V{report.manifestVersion ?? "?"}</p>
          {shareable && (
            <div className="reportActions">
              <a href={`/extension/${report.id}`}>Permanent report URL</a>
              <a
                href={`https://chromewebstore.google.com/detail/${report.id}`}
                target="_blank"
                rel="noreferrer"
              >
                Chrome Web Store
              </a>
            </div>
          )}
        </div>
        <div className={`summaryBadge ${highCount > 0 ? "attention" : "quiet"}`}>
          <strong>{highCount}</strong>
          <span>high-sensitivity required capabilities</span>
        </div>
      </div>

      <div className="grid">
        <Panel title="Required capabilities">
          {report.capabilities.length === 0 ? (
            <Empty>No mapped high-level required capabilities found.</Empty>
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

        <Panel title="Required API permissions">
          <TokenList values={report.permissions} empty="No required API permissions declared." />
        </Panel>

        <Panel title="Required website access">
          <TokenList values={[...report.hostPermissions, ...report.contentScriptMatches]} empty="No required host patterns or content-script matches found." />
        </Panel>

        <Panel title="Optional API permissions">
          <TokenList values={report.optionalPermissions} empty="No optional API permissions declared." />
        </Panel>

        <Panel title="Optional website access">
          <TokenList values={report.optionalHostPermissions} empty="No optional host permissions declared." />
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
