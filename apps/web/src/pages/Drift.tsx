import { Link } from "react-router-dom";
import { api, useApi } from "../lib/api.js";
import { Badge, Card, Empty, ErrorBox, Loading, PageHeader, StatCard } from "../components/ui.js";

export function DriftPage() {
  const drift = useApi(() => api.drift(), []);
  const agents = useApi(() => api.agents(), []);

  if (drift.error) return <ErrorBox error={drift.error} />;
  if (drift.loading) return <Loading label="Comparing snapshots…" />;
  const event = drift.data?.[0];
  if (!event) return <Empty>No drift data available.</Empty>;

  const agent = agents.data?.[0];
  const positive = event.changes.filter((c) => c.riskDelta > 0);
  const negative = event.changes.filter((c) => c.riskDelta < 0);

  return (
    <div className="col">
      <PageHeader
        title="Permission Drift"
        sub={`${agent?.name ?? event.agentId} · snapshot A → snapshot B`}
        right={<Badge tone={event.riskDelta > 0 ? "critical" : "ok"}>risk delta {event.riskDelta > 0 ? "+" : ""}{event.riskDelta}</Badge>}
      />

      <div className="grid cols-4">
        <StatCard label="Version A" value="1.0.0" hint={event.fromSnapshotId.slice(0, 14)} />
        <StatCard label="Version B" value="2.0.0" hint={event.toSnapshotId.slice(0, 14)} />
        <StatCard label="Changed capabilities" value={event.changedCapabilityCount} />
        <StatCard
          label="Risk delta"
          value={`${event.riskDelta > 0 ? "+" : ""}${event.riskDelta}`}
          deltaDir={event.riskDelta > 0 ? "up" : "down"}
          delta={`${positive.length} increasing`}
        />
      </div>

      <Card title="Summary">
        <p className="small" style={{ margin: 0 }}>{event.summary}</p>
      </Card>

      <div className="split">
        <Card title="Why did risk increase?" sub="exact contributing changes">
          {positive.length === 0 ? (
            <span className="dim small">No risk-increasing changes.</span>
          ) : (
            <table className="table">
              <thead><tr><th>Change</th><th>Subject</th><th>Detail</th><th className="right">Δ</th></tr></thead>
              <tbody>
                {positive.map((c, i) => (
                  <tr key={i}>
                    <td><Badge tone="high">{c.kind}</Badge></td>
                    <td className="mono tiny">{c.subject}</td>
                    <td className="tiny dim">{c.detail}</td>
                    <td className="right" style={{ color: "var(--critical)" }}>+{c.riskDelta}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>

        <Card title="All changes" sub="full posture diff">
          {event.changes.length === 0 ? (
            <span className="dim small">No changes between snapshots.</span>
          ) : (
            <div className="col" style={{ gap: 6, maxHeight: 420, overflowY: "auto" }}>
              {event.changes.map((c, i) => (
                <div className="row between" key={i} style={{ borderBottom: "1px solid var(--border)", paddingBottom: 6 }}>
                  <span className="row" style={{ gap: 8 }}>
                    <span className="mono tiny" style={{ color: c.riskDelta > 0 ? "var(--critical)" : "var(--ok)" }}>
                      {c.riskDelta > 0 ? "+" : "−"}
                    </span>
                    <span className="small">{c.detail}</span>
                  </span>
                  <Badge tone={c.riskDelta > 0 ? "high" : "ok"}>{c.riskDelta}</Badge>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      {negative.length > 0 && (
        <Card title="Reductions" sub="changes that lowered risk">
          <div className="col" style={{ gap: 6 }}>
            {negative.map((c, i) => (
              <div className="row between small" key={i}>
                <span>{c.detail}</span>
                <span style={{ color: "var(--ok)" }}>{c.riskDelta}</span>
              </div>
            ))}
          </div>
        </Card>
      )}

      <div className="row">
        <Link className="btn" to="/graph">View Trust Graph</Link>
        <Link className="btn" to="/blast-radius">View Blast Radius</Link>
      </div>
    </div>
  );
}
