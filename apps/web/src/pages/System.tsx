import { useEffect, useState } from "react";
import { api, useApi } from "../lib/api.js";
import { Badge, Card, Empty, ErrorBox, Loading, PageHeader, SeverityBadge } from "../components/ui.js";
import { fmtDateTime } from "../lib/format.js";

export function PoliciesPage() {
  const policies = useApi(() => api.policies(), []);
  if (policies.error) return <ErrorBox error={policies.error} />;
  if (policies.loading || !policies.data) return <Loading label="Loading policies…" />;

  return (
    <div className="col">
      <PageHeader title="Policies" sub={`${policies.data.name} v${policies.data.version} · deterministic, code-evaluated rules`} />
      <Card title={`Rules (${policies.data.rules.length})`} sub="first matching rule by priority wins">
        <table className="table">
          <thead>
            <tr><th>Priority</th><th>Rule</th><th>Match</th><th>Outcome</th><th>Severity</th></tr>
          </thead>
          <tbody>
            {[...policies.data.rules].sort((a, b) => a.priority - b.priority).map((r) => (
              <tr key={r.id}>
                <td>{r.priority}</td>
                <td>
                  <div style={{ fontWeight: 600 }}>{r.name}</div>
                  <div className="tiny faint">{r.description}</div>
                </td>
                <td className="mono tiny">{Object.entries(r.match).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(" ")}</td>
                <td><Badge tone={r.outcome === "DENY" ? "critical" : r.outcome === "REQUIRE_APPROVAL" ? "high" : r.outcome === "WARN" ? "medium" : "ok"}>{r.outcome}</Badge></td>
                <td><SeverityBadge severity={r.severity} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

export function ProvidersPage() {
  const providers = useApi(() => api.providers(), []);
  const [checking, setChecking] = useState(false);

  async function recheck() {
    setChecking(true);
    try {
      await fetch("/api/providers/health");
      providers.reload();
    } finally {
      setChecking(false);
    }
  }

  // A provider's status is the LAST health check, and it is null until one has
  // run. Without a check on mount every provider reads as disconnected even when
  // it is fine, so the page runs one itself.
  useEffect(() => {
    void (async () => {
      await fetch("/api/providers/health");
      providers.reload();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (providers.error) return <ErrorBox error={providers.error} />;
  if (providers.loading || !providers.data) return <Loading label="Checking providers…" />;

  return (
    <div className="col">
      <PageHeader
        title="Model Providers"
        sub="Only providers whose health check succeeded are shown as connected."
        right={<button className="btn" disabled={checking} onClick={recheck}>{checking ? "Checking…" : "↻ Re-check"}</button>}
      />
      <Card title="Configured Providers">
        <table className="table">
          <thead><tr><th>Provider</th><th>Model</th><th>Type</th><th>Status</th><th>Latency</th><th>Last checked</th></tr></thead>
          <tbody>
            {providers.data.map((p) => (
              <tr key={p.id}>
                <td className="mono">{p.id}</td>
                <td className="mono tiny">{p.model}</td>
                <td className="tiny dim">{p.kind}</td>
                <td>
                  <Badge tone={p.health ? (p.health.ok ? "ok" : "critical") : "info"}>
                    {p.health ? (p.health.ok ? "● Connected" : "○ Check failed") : "○ Not checked yet"}
                  </Badge>
                </td>
                <td className="tiny">{p.health?.latencyMs != null ? `${p.health.latencyMs}ms` : "—"}</td>
                <td className="tiny faint">{p.health ? fmtDateTime(p.health.checkedAt) : "never"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <Card title="Notes">
        <p className="small dim" style={{ margin: 0 }}>
          API keys are read from the backend environment only and are never sent to the browser. When no external provider is
          reachable, AgentGuard falls back to its deterministic local engine and clearly labels the output — it never fabricates model results.
        </p>
      </Card>
    </div>
  );
}

export function ReportsPage() {
  const missions = useApi(() => api.missions(), []);
  const [report, setReport] = useState<Awaited<ReturnType<typeof api.report>> | null>(null);
  const [busy, setBusy] = useState(false);

  async function generate(missionId: string) {
    setBusy(true);
    try {
      setReport(await api.report(missionId));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="col">
      <PageHeader title="Reports" sub="Every metric is computed from stored mission data — nothing is hardcoded." />

      <Card title="Missions">
        {missions.loading ? (
          <Loading />
        ) : (missions.data ?? []).length === 0 ? (
          <Empty>No missions yet.</Empty>
        ) : (
          <table className="table">
            <thead><tr><th>Mission</th><th>Scenario</th><th>Risk</th><th>Findings</th><th></th></tr></thead>
            <tbody>
              {(missions.data ?? []).map((m) => (
                <tr key={m.id}>
                  <td className="mono tiny">{m.id.slice(0, 14)}…</td>
                  <td className="tiny">{m.scenarioId}</td>
                  <td>{m.risk?.score ?? "—"}</td>
                  <td>{m.findings.length}</td>
                  <td className="right"><button className="btn sm" disabled={busy} onClick={() => generate(m.id)}>Generate</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {report && (
        <Card title={`Report ${report.id}`} sub={`${report.kind} · generated ${fmtDateTime(report.generatedAt)}`} right={<Badge tone="ok">ready</Badge>}>
          <div className="grid cols-2">
            <div>
              <div className="card-title">Metrics</div>
              <pre className="mono tiny" style={{ whiteSpace: "pre-wrap", color: "var(--text-dim)" }}>
                {JSON.stringify(report.metrics, null, 2)}
              </pre>
            </div>
            <div>
              {report.sections.map((s) => (
                <div key={s.heading} style={{ marginBottom: 12 }}>
                  <div className="card-title">{s.heading}</div>
                  <p className="small" style={{ whiteSpace: "pre-wrap", marginTop: 4 }}>{s.body}</p>
                </div>
              ))}
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}
