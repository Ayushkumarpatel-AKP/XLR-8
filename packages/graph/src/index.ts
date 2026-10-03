import {
  type AgentManifest,
  type BlastRadius,
  type CapabilityGraph,
  type EdgeKind,
  type GraphEdge,
  type GraphNode,
  nowIso,
} from "@agentguard/contracts";

const EDGE_DOMAIN: Record<EdgeKind, string> = {
  READ: "data",
  WRITE: "data",
  EXECUTE: "compute",
  SEND: "communications",
  NETWORK: "network",
  FINANCIAL: "money",
  DEVICE_CONTROL: "physical",
  TRUST: "trust",
};

const NODE_KIND_IMPACT: Record<string, "low" | "medium" | "high" | "critical"> = {
  payment: "critical",
  iot: "critical",
  data_store: "high",
  crm: "medium",
  email: "medium",
  api: "medium",
  external_service: "high",
  mcp_server: "low",
  tool: "low",
  agent: "low",
};

function edgeImpact(edge: EdgeKind, external: boolean): "low" | "medium" | "high" | "critical" {
  if (edge === "FINANCIAL" || edge === "DEVICE_CONTROL") return "critical";
  if (edge === "WRITE" || edge === "SEND") return external ? "high" : "medium";
  if (edge === "NETWORK" || edge === "TRUST") return external ? "high" : "medium";
  return "low";
}

function worst(a: string, b: string): "low" | "medium" | "high" | "critical" {
  const order = ["low", "medium", "high", "critical"];
  return order[Math.max(order.indexOf(a), order.indexOf(b))] as "low" | "medium" | "high" | "critical";
}

/** Build the capability/trust graph for one agent from its manifest. */
export function buildCapabilityGraph(manifest: AgentManifest): CapabilityGraph {
  const nodes = new Map<string, GraphNode>();
  const edges: GraphEdge[] = [];
  let edgeSeq = 0;
  const edgeId = () => `e${++edgeSeq}_${manifest.id}`;

  nodes.set(manifest.id, {
    id: manifest.id,
    kind: "agent",
    label: manifest.name,
    riskLevel: "low",
    metadata: { model: manifest.model, environment: manifest.environment },
  });

  for (const tool of manifest.tools) {
    const toolNodeId = `tool:${tool.name}`;
    nodes.set(toolNodeId, {
      id: toolNodeId,
      kind: "tool",
      label: tool.name,
      riskLevel: tool.edge === "FINANCIAL" || tool.edge === "DEVICE_CONTROL" ? "high" : "low",
      metadata: { sideEffect: tool.sideEffect, external: tool.external, mcpServer: tool.mcpServer ?? null },
    });
    edges.push({
      id: edgeId(),
      from: manifest.id,
      to: toolNodeId,
      kind: "EXECUTE",
      label: "can invoke",
      evidenceIds: [],
    });

    for (const target of tool.targets) {
      if (!nodes.has(target.id)) {
        nodes.set(target.id, {
          id: target.id,
          kind: target.kind,
          label: target.label,
          riskLevel: NODE_KIND_IMPACT[target.kind] ?? "medium",
          metadata: {},
        });
      }
      edges.push({
        id: edgeId(),
        from: toolNodeId,
        to: target.id,
        kind: target.edge,
        label: `${target.edge.toLowerCase()} → ${target.label}`,
        evidenceIds: [],
      });
    }

    if (tool.external) {
      const extId = `ext:${tool.name}`;
      if (!nodes.has(extId)) {
        nodes.set(extId, {
          id: extId,
          kind: "external_service",
          label: `${tool.name} (external)`,
          riskLevel: "high",
          metadata: {},
        });
      }
      edges.push({
        id: edgeId(),
        from: toolNodeId,
        to: extId,
        kind: "NETWORK",
        label: "network egress",
        evidenceIds: [],
      });
    }
  }

  return { agentId: manifest.id, nodes: [...nodes.values()], edges, builtAt: nowIso() };
}

/**
 * Compute reachable impact from the agent by traversing graph edges. This is a
 * simulation only — it calculates what *could* be reached, never executes it.
 */
export function computeBlastRadius(graph: CapabilityGraph): BlastRadius {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const outgoing = new Map<string, GraphEdge[]>();
  for (const e of graph.edges) {
    const list = outgoing.get(e.from) ?? [];
    list.push(e);
    outgoing.set(e.from, list);
  }

  const root = graph.agentId;
  const visited = new Map<string, { path: string[]; impact: string; domain: string; edge: EdgeKind }>();
  const queue: Array<{ id: string; path: string[]; impact: string; edge: EdgeKind }> = [
    { id: root, path: [root], impact: "low", edge: "EXECUTE" },
  ];

  while (queue.length > 0) {
    const cur = queue.shift()!;
    if (visited.has(cur.id)) continue;
    visited.set(cur.id, { path: cur.path, impact: cur.impact, domain: EDGE_DOMAIN[cur.edge], edge: cur.edge });
    for (const e of outgoing.get(cur.id) ?? []) {
      if (visited.has(e.to)) continue;
      const node = byId.get(e.to);
      const base = NODE_KIND_IMPACT[node?.kind ?? "api"] ?? "medium";
      const impact = worst(base, worst(edgeImpact(e.kind, node?.kind === "external_service"), cur.impact));
      queue.push({ id: e.to, path: [...cur.path, e.to], impact, edge: e.kind });
    }
  }

  const reachable = [...visited.entries()]
    .filter(([id]) => id !== root)
    .map(([id, v]) => ({
      nodeId: id,
      label: byId.get(id)?.label ?? id,
      kind: byId.get(id)?.kind ?? "unknown",
      path: v.path,
      impact: v.impact as "low" | "medium" | "high" | "critical",
      domain: v.domain,
      evidenceIds: [] as string[],
    }))
    .sort((a, b) => {
      const order = ["critical", "high", "medium", "low"];
      return order.indexOf(a.impact) - order.indexOf(b.impact);
    });

  return {
    agentId: root,
    reachable,
    affectedDomains: [...new Set(reachable.map((r) => r.domain))],
    riskDimensions: [...new Set(reachable.map((r) => `${r.domain}:${r.impact}`))],
    computedAt: nowIso(),
  };
}
