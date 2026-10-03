import { api, useApi, useToolPulses } from "../lib/api.js";
import { Card, ErrorBox, Loading, PageHeader, StatCard } from "../components/ui.js";
import { GraphCanvas } from "../components/GraphCanvas.js";

export function GraphPage() {
  const agents = useApi(() => api.agents(), []);
  const agentId = agents.data?.[0]?.id;
  const graph = useApi(() => (agentId ? api.graph(agentId) : Promise.resolve(null)), [agentId]);
  const pulses = useToolPulses();

  if (agents.error) return <ErrorBox error={agents.error} />;
  if (!agentId || graph.loading) return <Loading label="Building graph…" />;
  if (graph.error) return <ErrorBox error={graph.error} />;
  if (!graph.data) return <Loading />;

  const edgeKinds = [...new Set(graph.data.edges.map((e) => e.kind))];

  return (
    <div className="col">
      <PageHeader title="Trust & Capability Graph" sub="Nodes are agents, tools and the services they can actually reach." />

      <div className="grid cols-4">
        <StatCard label="Nodes" value={graph.data.nodes.length} />
        <StatCard label="Edges" value={graph.data.edges.length} />
        <StatCard label="Edge kinds" value={edgeKinds.length} hint={edgeKinds.join(", ")} />
        <StatCard label="External reach" value={graph.data.edges.filter((e) => e.kind === "NETWORK").length} hint="live: nodes pulse on tool calls" />
      </div>

      <Card title="Graph" sub="hover a node to trace its edges · edges animate where data can flow">
        <GraphCanvas graph={graph.data} pulse={pulses} height={520} />
      </Card>
    </div>
  );
}
