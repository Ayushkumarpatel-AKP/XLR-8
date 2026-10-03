import { useMemo, useState } from "react";
import type { CapabilityGraph, GraphEdge, GraphNode } from "@agentguard/contracts";

const KIND_COLOR: Record<string, string> = {
  agent: "#eb7d00",
  tool: "#5aa9e6",
  mcp_server: "#7f8a72",
  data_store: "#e0b64a",
  api: "#4fd1c5",
  payment: "#ef4d5a",
  email: "#c07adf",
  crm: "#4fbf7a",
  iot: "#ef4d5a",
  external_service: "#f0a13c",
};

const EDGE_COLOR: Record<string, string> = {
  READ: "#5aa9e6",
  WRITE: "#e0b64a",
  EXECUTE: "#7f8a72",
  SEND: "#c07adf",
  NETWORK: "#eb7d00",
  FINANCIAL: "#ef4d5a",
  DEVICE_CONTROL: "#ef4d5a",
  TRUST: "#4fbf7a",
};

/** Edge kinds that animate as a flowing stream. */
const FLOW_EDGES = new Set(["NETWORK", "FINANCIAL", "SEND", "TRUST"]);

interface Layout {
  positions: Map<string, { x: number; y: number }>;
  degrees: Map<string, number>;
}

function radialLayout(nodes: GraphNode[], edges: GraphEdge[], rootId: string, width: number, height: number): Layout {
  const positions = new Map<string, { x: number; y: number }>();
  const degrees = new Map<string, number>();
  for (const e of edges) {
    degrees.set(e.from, (degrees.get(e.from) ?? 0) + 1);
    degrees.set(e.to, (degrees.get(e.to) ?? 0) + 1);
  }

  const cx = width / 2;
  const cy = height / 2;
  positions.set(rootId, { x: cx, y: cy });

  const others = nodes.filter((n) => n.id !== rootId);
  const inner = others.filter((n) => n.kind === "tool" || n.kind === "mcp_server");
  const outer = others.filter((n) => !inner.includes(n));

  const place = (list: GraphNode[], radius: number, phase = 0) => {
    list.forEach((n, i) => {
      const angle = (i / Math.max(1, list.length)) * Math.PI * 2 + phase;
      positions.set(n.id, { x: cx + Math.cos(angle) * radius, y: cy + Math.sin(angle) * radius * 0.82 });
    });
  };
  const base = Math.min(width, height);
  place(inner, base * 0.28, -Math.PI / 2);
  place(outer, base * 0.45, 0.35);
  return { positions, degrees };
}

export function GraphCanvas({
  graph,
  highlight,
  pulse,
  rootId,
  height = 480,
  showLegend = true,
}: {
  graph: CapabilityGraph;
  highlight?: string[];
  /** Node ids that should pulse (e.g. touched by a live event). */
  pulse?: Set<string>;
  rootId?: string;
  height?: number;
  showLegend?: boolean;
}) {
  const width = 900;
  const root = rootId ?? graph.agentId;
  const [hover, setHover] = useState<string | null>(null);
  const layout = useMemo(
    () => radialLayout(graph.nodes, graph.edges, root, width, height),
    [graph, root, height],
  );
  const highlightSet = new Set(highlight ?? []);
  const nodeById = useMemo(() => new Map(graph.nodes.map((n) => [n.id, n])), [graph]);

  const kinds = [...new Set(graph.nodes.map((n) => n.kind))];
  const hovered = hover ? nodeById.get(hover) : null;

  return (
    <div className="graph-wrap" style={{ height }}>
      <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`}>
        <defs>
          <pattern id="grid" width="26" height="26" patternUnits="userSpaceOnUse">
            <path d="M 26 0 L 0 0 0 26" fill="none" stroke="#171a12" strokeWidth="1" />
          </pattern>
          <radialGradient id="glow" cx="50%" cy="50%" r="60%">
            <stop offset="0%" stopColor="#2c5745" stopOpacity="0.30" />
            <stop offset="100%" stopColor="#2c5745" stopOpacity="0" />
          </radialGradient>
        </defs>

        <rect width={width} height={height} fill="url(#grid)" />
        <rect width={width} height={height} fill="url(#glow)" />

        {graph.edges.map((e) => {
          const a = layout.positions.get(e.from);
          const b = layout.positions.get(e.to);
          if (!a || !b) return null;
          const active = hover === e.from || hover === e.to || highlightSet.has(e.to) || highlightSet.has(e.from);
          const color = EDGE_COLOR[e.kind] ?? "#2a2f20";
          const flowing = FLOW_EDGES.has(e.kind) && (active || highlightSet.size === 0);
          return (
            <g key={e.id}>
              <line
                x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                stroke={color}
                strokeWidth={active ? 2.2 : 1}
                opacity={active ? 0.95 : 0.28}
              />
              {flowing && (
                <line
                  className="edge-flow"
                  x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                  stroke={color}
                  strokeWidth={active ? 2.6 : 1.6}
                  opacity={active ? 0.9 : 0.35}
                />
              )}
              {active && (
                <text x={(a.x + b.x) / 2} y={(a.y + b.y) / 2 - 4} textAnchor="middle" className="edge-label">
                  {e.kind}
                </text>
              )}
            </g>
          );
        })}

        {graph.nodes.map((n) => {
          const p = layout.positions.get(n.id);
          if (!p) return null;
          const color = KIND_COLOR[n.kind] ?? "#9aa088";
          const isRoot = n.id === root;
          const r = isRoot ? 30 : n.kind === "tool" ? 14 : 18;
          const isPulsing = pulse?.has(n.id);
          const focused = hover === n.id || highlightSet.has(n.id);
          return (
            <g
              key={n.id}
              onMouseEnter={() => setHover(n.id)}
              onMouseLeave={() => setHover(null)}
              style={{ cursor: "pointer" }}
            >
              {isPulsing && <circle className="node-halo" cx={p.x} cy={p.y} r={r + 2} fill={color} opacity={0.5} />}
              {isRoot && <circle cx={p.x} cy={p.y} r={r + 8} fill="none" stroke={color} opacity={0.3} />}
              <circle
                cx={p.x} cy={p.y} r={r}
                fill="#0b0d09"
                stroke={color}
                strokeWidth={focused ? 3.5 : isRoot ? 3 : 2}
                opacity={highlightSet.size > 0 && !focused && !isRoot ? 0.45 : 1}
              />
              <text
                x={p.x} y={p.y + 3} textAnchor="middle"
                className="node-label" fill={color} fontSize={isRoot ? 10 : 9}
              >
                {isRoot ? "AGENT" : n.kind === "tool" ? "T" : "◆"}
              </text>
              <text x={p.x} y={p.y + r + 12} textAnchor="middle" className="node-label">
                {n.label.length > 18 ? n.label.slice(0, 17) + "…" : n.label}
              </text>
            </g>
          );
        })}
      </svg>

      {showLegend && (
        <div className="graph-legend">
          {kinds.map((k) => (
            <span key={k}>
              <span className="dot" style={{ background: KIND_COLOR[k] ?? "#9aa088" }} />
              {k}
            </span>
          ))}
        </div>
      )}

      {hovered && (
        <div className="graph-tip">
          {hovered.label} · {hovered.kind} · {layout.degrees.get(hovered.id) ?? 0} connection(s)
        </div>
      )}
    </div>
  );
}
