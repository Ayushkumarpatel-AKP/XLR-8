import { useState } from "react";
import { Link } from "react-router-dom";
import type { Finding } from "@agentguard/contracts";
import { api, useApi } from "../lib/api.js";
import { Badge, Card, Empty, ErrorBox, Loading, PageHeader, SeverityBadge, StatCard } from "../components/ui.js";
import { fmtDateTime, SEVERITY_ORDER, severityRank } from "../lib/format.js";

export function FindingsPage() {
  const findings = useApi(() => api.findings(), []);
  const [severity, setSeverity] = useState<string>("all");
  const [status, setStatus] = useState<string>("all");
  const [selected, setSelected] = useState<Finding | null>(null);
  const evidence = useApi(() => api.evidence(), []);

  if (findings.error) return <ErrorBox error={findings.error} />;
  if (findings.loading) return <Loading label="Loading findings…" />;

  const all = findings.data ?? [];
  const filtered = all
    .filter((f) => severity === "all" || f.severity === severity)
    .filter((f) => status === "all" || f.status === status)
    .sort((a, b) => severityRank(a.severity) - severityRank(b.severity));

  const counts = SEVERITY_ORDER.reduce((acc, s) => ({ ...acc, [s]: filtered.filter((f) => f.severity === s).length }), {} as Record<string, number>);

  return (
    <div className="col">
      <PageHeader title="Findings Center" sub="Every finding is backed by evidence — no AI-only conclusions." />

      <div className="row between" style={{ marginBottom: 8 }}>
        <div className="card-title">Severity in the current filter</div>
        <div className="card-sub">
          showing {filtered.length} of {all.length} findings · severity {severity} · status {status}
        </div>
      </div>

      <div className="grid cols-5">
        {SEVERITY_ORDER.map((s) => (
          <StatCard key={s} label={s} value={counts[s] ?? 0} />
        ))}
      </div>

      <Card
        title="Filters"
        right={
          <div className="row">
            <select className="input" value={status} onChange={(e) => setStatus(e.target.value)}>
              {["all", "open", "mitigated", "accepted", "false_positive"].map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
        }
      >
        <div className="row" style={{ flexWrap: "wrap", gap: 6 }}>
          {["all", ...SEVERITY_ORDER].map((s) => (
            <span key={s} className={`filter-chip${severity === s ? " active" : ""}`} onClick={() => setSeverity(s)}>{s}</span>
          ))}
        </div>
      </Card>

      <Card
        title={`Findings — ${filtered.length} of ${all.length}`}
        sub="The table shows only the findings that pass the filters above."
      >
        {filtered.length === 0 ? (
          all.length === 0 ? (
            <Empty>
              No findings have been recorded for this agent yet.{" "}
              <Link to="/dashboard">Run a mission from the Dashboard</Link> — everything it reports comes with the
              evidence that produced it.
            </Empty>
          ) : (
            <Empty>
              None of the {all.length} findings pass the current filter (severity {severity}, status {status}).{" "}
              <button
                className="btn sm"
                onClick={() => {
                  setSeverity("all");
                  setStatus("all");
                }}
              >
                Clear filters
              </button>{" "}
              or <Link to="/dashboard">run another mission</Link> to look for different ones.
            </Empty>
          )
        ) : (
          <table className="table">
            <thead>
              <tr><th>Severity</th><th>Title</th><th>Category</th><th>Tool</th><th>Status</th><th>Evidence</th><th>Detected</th><th></th></tr>
            </thead>
            <tbody>
              {filtered.map((f) => (
                <tr key={f.id}>
                  <td><SeverityBadge severity={f.severity} /></td>
                  <td>{f.title}</td>
                  <td className="tiny dim">{f.category}</td>
                  <td className="mono tiny">{f.toolName ?? "—"}</td>
                  <td><Badge tone={f.status === "open" ? "high" : "ok"}>{f.status}</Badge></td>
                  <td className="tiny">{f.evidenceIds.length}</td>
                  <td className="tiny faint">{fmtDateTime(f.createdAt)}</td>
                  <td className="right"><button className="btn sm" onClick={() => setSelected(f)}>Evidence</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {selected && (
        <>
          <div className="drawer-backdrop" onClick={() => setSelected(null)} />
          <aside className="drawer">
            <div className="row between">
              <SeverityBadge severity={selected.severity} />
              <button className="btn sm" onClick={() => setSelected(null)}>✕ Close</button>
            </div>
            <h3 style={{ margin: "12px 0 6px" }}>{selected.title}</h3>
            <p className="small dim">{selected.description}</p>

            <div className="card" style={{ background: "var(--panel)", marginTop: 12 }}>
              <div className="card-title">Recommendation</div>
              <p className="small" style={{ marginBottom: 0 }}>{selected.recommendation}</p>
            </div>

            <div className="card-title" style={{ marginTop: 16 }}>Evidence ({selected.evidenceIds.length})</div>
            <div className="col" style={{ gap: 8 }}>
              {(evidence.data ?? []).filter((e) => selected.evidenceIds.includes(e.id)).map((e) => (
                <div className="card" key={e.id} style={{ background: "var(--panel)", padding: 12 }}>
                  <div className="row between">
                    <Badge tone="low">{e.source}</Badge>
                    <span className="tiny faint mono">{e.contentDigest.slice(0, 20)}…</span>
                  </div>
                  <div className="small" style={{ marginTop: 6 }}>{e.summary}</div>
                  <pre className="mono tiny" style={{ whiteSpace: "pre-wrap", color: "var(--text-dim)", margin: "8px 0 0", maxHeight: 180, overflow: "auto" }}>
                    {JSON.stringify(e.content, null, 2)}
                  </pre>
                </div>
              ))}
            </div>
          </aside>
        </>
      )}
    </div>
  );
}
