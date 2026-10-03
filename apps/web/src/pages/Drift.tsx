import { useState } from "react";
import { Link } from "react-router-dom";
import { api, useApi } from "../lib/api.js";
import { useAgents } from "../lib/agent-context.js";
import { fmtDateTime } from "../lib/format.js";
import { Badge, Card, Empty, ErrorBox, Loading, PageHeader, StatCard } from "../components/ui.js";

export function DriftPage() {
  const drift = useApi(() => api.drift(), []);
  const { targets, active } = useAgents();
  const [selected, setSelected] = useState(0);

  if (drift.error) return <ErrorBox error={drift.error} />;
  if (drift.loading) return <Loading label="Comparing snapshots…" />;

  const events = drift.data ?? [];
  const index = Math.min(selected, Math.max(events.length - 1, 0));
  const event = events[index];

  if (!event) {
    return (
      <div className="col">
        <PageHeader title="Permission Drift" sub="Two snapshots of one agent, diffed down to the exact permission that moved." />
        <Empty>
          No drift event exists for this agent yet — a baseline is stored the first time the agent is audited or
          run. <Link to="/dashboard">Run a mission to capture a baseline</Link>, or{" "}
          <Link to="/agents">pick a different agent</Link>.
        </Empty>
      </div>
    );
  }

  const agent = targets.find((t) => t.agentId === event.agentId) ?? active;
  // The fallback only names the agent when it really is the one this event is about.
  const agentName = agent && agent.agentId === event.agentId ? agent.name : event.agentId;
  const positive = event.changes.filter((c) => c.riskDelta > 0);
  const negative = event.changes.filter((c) => c.riskDelta < 0);

  return (
    <div className="col">
      <PageHeader
        title="Permission Drift"
        sub={`${agentName} · ${event.fromSnapshotId.slice(0, 16)}… → ${event.toSnapshotId.slice(0, 16)}… · compared ${fmtDateTime(event.createdAt)}`}
        right={
          <div className="row" style={{ gap: 8 }}>
            <select
              className="input"
              aria-label="Drift event"
              value={index}
              onChange={(e) => setSelected(Number(e.target.value))}
            >
              {events.map((e, i) => (
                <option key={e.id} value={i}>
                  {fmtDateTime(e.createdAt)} · {e.fromSnapshotId.slice(0, 10)}… → {e.toSnapshotId.slice(0, 10)}…
                </option>
              ))}
            </select>
            <Badge tone={event.riskDelta > 0 ? "critical" : "ok"}>
              risk delta {event.riskDelta > 0 ? "+" : ""}
              {event.riskDelta}
            </Badge>
          </div>
        }
      />

      <div className="grid cols-4">
        <StatCard label="Changed capabilities" value={event.changedCapabilityCount} />
        <StatCard label="Risk-increasing" value={positive.length} hint="changes that raised risk" />
        <StatCard label="Risk-reducing" value={negative.length} hint="changes that lowered risk" />
        <StatCard
          label="Risk delta"
          value={`${event.riskDelta > 0 ? "+" : ""}${event.riskDelta}`}
          deltaDir={event.riskDelta > 0 ? "up" : "down"}
          delta={`${event.newAttackSurface.length} new attack-surface categories`}
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
        <Link className="btn" to="/trust">View Trust &amp; Capability</Link>
      </div>
    </div>
  );
}
