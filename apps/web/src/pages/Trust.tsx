import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { BlastRadius } from "@agentguard/contracts";
import { api, useApi, useToolPulses } from "../lib/api.js";
import { agentLabel, useAgents } from "../lib/agent-context.js";
import { Badge, Card, Empty, ErrorBox, Loading, PageHeader, SeverityBadge, StatCard } from "../components/ui.js";
import { ImpactGraph } from "../components/ImpactGraph.js";

export function TrustPage() {
  const { targets, activeAgentId, setActiveAgentId, loading: agentsLoading, error: agentsError } = useAgents();
  const activeId = activeAgentId ?? targets[0]?.agentId ?? null;
  const target = targets.find((t) => t.agentId === activeId) ?? null;

  const graph = useApi(() => (activeId ? api.graph(activeId) : Promise.resolve(null)), [activeId]);
  const pulses = useToolPulses();

  const [blast, setBlast] = useState<BlastRadius | null>(null);
  const [busy, setBusy] = useState(false);
  const [blastError, setBlastError] = useState<string | null>(null);
  const [pinned, setPinned] = useState<string | null>(null);

  const blastForActive = blast && blast.agentId === activeId ? blast : null;

  const impact = useMemo(
    () => new Map((blastForActive?.reachable ?? []).map((r) => [r.nodeId, r.impact] as const)),
    [blastForActive],
  );
  const paths = useMemo(
    () => new Map((blastForActive?.reachable ?? []).map((r) => [r.nodeId, r.path] as const)),
    [blastForActive],
  );

  async function simulate() {
    if (!activeId) return;
    setBusy(true);
    setBlastError(null);
    try {
      setBlast(await api.blastRadius(activeId));
    } catch (e) {
      setBlastError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const edgeKinds = graph.data ? [...new Set(graph.data.edges.map((e) => e.kind))] : [];
  const reachable = blastForActive?.reachable ?? [];
  const impacted = reachable.filter((r) => r.impact === "critical" || r.impact === "high");

  return (
    <div className="col">
      <PageHeader
        title="Trust & Capability"
        sub={
          target
            ? `Scoped to ${target.name} — the graph and simulation below describe this agent.`
            : "What each agent can reach, and what a compromise of it would touch."
        }
        right={
          target ? (
            <div className="row" style={{ gap: 8 }}>
              {targets.length > 1 && (
                <select
                  className="input"
                  value={activeId ?? ""}
                  onChange={(e) => {
                    setActiveAgentId(e.target.value || null);
                    setPinned(null);
                    setBlast(null);
                  }}
                >
                  {targets.map((t) => (
                    <option key={t.agentId} value={t.agentId}>
                      {agentLabel(t)}
                    </option>
                  ))}
                </select>
              )}
              <button className="btn primary" disabled={busy} onClick={simulate}>
                {busy ? "Simulating…" : "▶ Simulate impact"}
              </button>
            </div>
          ) : undefined
        }
      />

      {agentsError ? (
        <ErrorBox error={agentsError} />
      ) : agentsLoading ? (
        <Loading label="Loading agents…" />
      ) : targets.length === 0 ? (
        <Card title="No agent is registered yet">
          <p className="small dim" style={{ marginTop: 0 }}>
            AgentGuard reads an agent's declared capability surface — its tools, permissions and the services
            they can reach — and maps what a compromise would expose. Import one to populate this view with
            real data.
          </p>
          <Link className="btn primary" to="/agents">Import an agent</Link>
        </Card>
      ) : (
        <>
          {graph.error && <ErrorBox error={graph.error} />}

          {graph.data && (
            <div className="grid cols-4">
              <StatCard label="Nodes" value={graph.data.nodes.length} />
              <StatCard label="Edges" value={graph.data.edges.length} />
              <StatCard label="Edge kinds" value={edgeKinds.length} hint={edgeKinds.join(", ")} />
              <StatCard
                label="External reach"
                value={graph.data.edges.filter((e) => e.kind === "NETWORK").length}
                hint="live: nodes pulse on tool calls"
              />
            </div>
          )}

          <Card
            title="Trust & Capability Graph"
            sub="hover a node to trace its edges · click to pin a path"
            right={target ? <Badge tone={target.interactive ? "ok" : "medium"}>{target.toolCount} tools</Badge> : undefined}
          >
            {graph.loading ? (
              <Loading label="Building graph…" />
            ) : graph.data ? (
              <>
                <ImpactGraph
                  graph={graph.data}
                  impact={impact}
                  paths={paths}
                  pulse={pulses}
                  selected={pinned}
                  onSelect={setPinned}
                  height={480}
                />
                {pinned && (
                  <div className="pin-strip">
                    <span className="chip tool">{pinned}</span>
                    {paths.get(pinned) && <span className="tiny faint">{paths.get(pinned)!.join(" → ")}</span>}
                  </div>
                )}
              </>
            ) : (
              <Empty>
                No graph for this agent yet. <Link to="/agents" style={{ color: "var(--orange)" }}>Import an agent</Link>
              </Empty>
            )}
          </Card>

          {blastError && <ErrorBox error={blastError} />}

          {blastForActive ? (
            <Card
              title="Blast radius"
              sub={`Simulation only — nothing is executed. Computed ${new Date(blastForActive.computedAt).toLocaleString()}.`}
            >
              <div className="grid cols-4" style={{ marginBottom: 14 }}>
                <StatCard label="Reachable items" value={reachable.length} />
                <StatCard label="High/Critical impact" value={impacted.length} deltaDir="up" />
                <StatCard label="Affected domains" value={blastForActive.affectedDomains.length} hint={blastForActive.affectedDomains.join(", ")} />
                <StatCard label="Risk dimensions" value={blastForActive.riskDimensions.length} />
              </div>
              <table className="table">
                <thead>
                  <tr><th>Impact</th><th>Reachable item</th><th>Domain</th><th>Path</th></tr>
                </thead>
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
          ) : (
            <Card title="Blast radius" sub="not yet simulated">
              <p className="small dim" style={{ marginTop: 0 }}>
                Simulate the reachable attack surface from this agent's graph. Nothing is executed — the paths
                are derived from declared capabilities.
              </p>
              <button className="btn primary" disabled={busy} onClick={simulate}>
                {busy ? "Simulating…" : "▶ Simulate impact"}
              </button>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
