import { useState } from "react";
import { api, useApi, useToolPulses } from "../lib/api.js";
import { Badge, Card, ErrorBox, Loading, PageHeader, SeverityBadge, StatCard } from "../components/ui.js";
import { GraphCanvas } from "../components/GraphCanvas.js";

export function BlastRadiusPage() {
  const agents = useApi(() => api.agents(), []);
  const agentId = agents.data?.[0]?.id;
  const graph = useApi(() => (agentId ? api.graph(agentId) : Promise.resolve(null)), [agentId]);
  const [blast, setBlast] = useState<Awaited<ReturnType<typeof api.blastRadius>> | null>(null);
  const [busy, setBusy] = useState(false);
  const pulses = useToolPulses();

  async function simulate() {
    if (!agentId) return;
    setBusy(true);
    try {
      setBlast(await api.blastRadius(agentId));
    } finally {
      setBusy(false);
    }
  }

  if (agents.error) return <ErrorBox error={agents.error} />;
  if (!agentId || graph.loading) return <Loading label="Loading…" />;

  const reachable = blast?.reachable ?? [];
  const impacted = reachable.filter((r) => r.impact === "critical" || r.impact === "high");

  return (
    <div className="col">
      <PageHeader
        title="Blast Radius Simulator"
        sub="Simulate the potential impact if this agent is compromised. Simulation only — nothing is executed."
        right={<button className="btn primary" disabled={busy} onClick={simulate}>{busy ? "Simulating…" : "▶ Simulate Impact"}</button>}
      />

      {blast && (
        <>
          <div className="grid cols-4">
            <StatCard label="Reachable nodes" value={reachable.length} />
            <StatCard label="High/Critical impact" value={impacted.length} deltaDir="up" />
            <StatCard label="Affected domains" value={blast.affectedDomains.length} hint={blast.affectedDomains.join(", ")} />
            <StatCard label="Risk dimensions" value={blast.riskDimensions.length} />
          </div>

          <div className="split">
            <Card title="Impact Paths" sub="derived from graph edges">
              <table className="table">
                <thead><tr><th>Impact</th><th>Asset</th><th>Domain</th><th>Path</th></tr></thead>
                <tbody>
                  {reachable.map((r) => (
                    <tr key={r.nodeId}>
                      <td><SeverityBadge severity={r.impact} /></td>
                      <td>{r.label}</td>
                      <td className="tiny dim">{r.domain}</td>
                      <td className="mono tiny truncate" style={{ maxWidth: 280 }}>{r.path.join(" → ")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>

            <Card title="Potential Real-world Impact">
              <div className="col" style={{ gap: 10 }}>
                {impacted.map((r) => (
                  <div className="card" key={r.nodeId} style={{ background: "var(--panel)", padding: 12 }}>
                    <div className="row between">
                      <span style={{ fontWeight: 700 }}>{r.label}</span>
                      <SeverityBadge severity={r.impact} />
                    </div>
                    <div className="tiny faint" style={{ marginTop: 6 }}>domain: {r.domain}</div>
                  </div>
                ))}
                {impacted.length === 0 && <span className="dim small">No high-impact assets reachable.</span>}
              </div>
            </Card>
          </div>
        </>
      )}

      {graph.data && (
        <Card title="Agent-centric view" sub="highlighted nodes are reachable in the simulation">
          <GraphCanvas graph={graph.data} highlight={reachable.map((r) => r.nodeId)} pulse={pulses} height={500} />
        </Card>
      )}

      {!blast && (
        <Card title="Simulation" sub="not yet run">
          <p className="small dim">Press <strong>Simulate Impact</strong> to compute the reachable attack surface from graph data.</p>
          <div className="row" style={{ gap: 8, marginTop: 8 }}>
            {["data", "money", "email", "external API", "IoT", "internal service"].map((d) => (
              <Badge key={d} tone="low">{d}</Badge>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
