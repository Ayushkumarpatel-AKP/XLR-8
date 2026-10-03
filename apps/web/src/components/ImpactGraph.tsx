import { useEffect, useMemo, useRef, useState } from "react";
import type { CapabilityGraph, GraphNode } from "@agentguard/contracts";

/* ------------------------------------------------------------------ *
 * Interactive, self-animating exposure graph.
 *
 * - draws itself in (agent → tools → services), edges animate
 * - pulses the exact tool the agent just called, then cascades to
 *   everything that tool can reach
 * - hover for details, click to pin a node and trace its path
 * - click the impact legend to filter
 * ------------------------------------------------------------------ */

export const IMPACT_COLOR: Record<string, string> = {
  critical: "#ef4d5a",
  high: "#f08a2a",
  medium: "#e0b64a",
  low: "#5aa9e6",
  none: "#7f8a72",
};

export const KIND_COLOR: Record<string, string> = {
  agent: "#eb7d00",
  tool: "#5aa9e6",
  mcp_server: "#8f9a82",
  data_store: "#e0b64a",
  api: "#4fd1c5",
  payment: "#ef4d5a",
  email: "#c07adf",
  crm: "#4fbf7a",
  iot: "#ef4d5a",
  external_service: "#f0a13c",
};

const KIND_GLYPH: Record<string, string> = {
  agent: "◉",
  tool: "⚒",
  mcp_server: "◈",
  data_store: "▤",
  api: "⬡",
  payment: "$",
  email: "✉",
  crm: "▣",
  iot: "⌂",
  external_service: "▲",
};

const IMPACT_ORDER = ["critical", "high", "medium", "low"] as const;

interface Positioned {
  node: GraphNode;
  x: number;
  y: number;
  ring: 0 | 1 | 2;
}

function layout(graph: CapabilityGraph, w: number, h: number): Map<string, Positioned> {
  const cx = w / 2;
  const cy = h / 2;
  const out = new Map<string, Positioned>();

  const root = graph.nodes.find((n) => n.id === graph.agentId) ?? graph.nodes[0];
  const tools = graph.nodes.filter((n) => n.kind === "tool" || n.kind === "mcp_server");
  const leaves = graph.nodes.filter((n) => n !== root && !tools.includes(n));

  if (root) out.set(root.id, { node: root, x: cx, y: cy, ring: 0 });

  const place = (list: GraphNode[], rx: number, ry: number, phase: number, ring: 1 | 2) => {
    list.forEach((node, i) => {
      const a = (i / Math.max(1, list.length)) * Math.PI * 2 + phase;
      out.set(node.id, { node, x: cx + Math.cos(a) * rx, y: cy + Math.sin(a) * ry, ring });
    });
  };
  place(tools, w * 0.27, h * 0.26, -Math.PI / 2, 1);
  place(leaves, w * 0.43, h * 0.41, 0.32, 2);
  return out;
}

export function ImpactGraph({
  graph,
  impact,
  paths,
  pulse,
  selected,
  onSelect,
  height = 360,
  showLegend = true,
}: {
  graph: CapabilityGraph;
  impact?: Map<string, string>;
  paths?: Map<string, string[]>;
  /** Node ids touched by the most recent live events. */
  pulse?: Set<string>;
  selected?: string | null;
  onSelect?: (nodeId: string | null) => void;
  height?: number;
  showLegend?: boolean;
}) {
  const W = 420;
  const H = height;
  const positions = useMemo(() => layout(graph, W, H), [graph, H]);
  const [hover, setHover] = useState<string | null>(null);
  const [filter, setFilter] = useState<string | null>(null);
  const [reveal, setReveal] = useState(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const order = useMemo(() => {
    const root = graph.nodes.find((n) => n.id === graph.agentId);
    const tools = graph.nodes.filter((n) => n.kind === "tool" || n.kind === "mcp_server");
    const leaves = graph.nodes.filter((n) => n !== root && !tools.includes(n));
    return [root, ...tools, ...leaves].filter(Boolean).map((n) => (n as GraphNode).id);
  }, [graph]);

  // Draw itself in, node by node.
  useEffect(() => {
    setReveal(0);
    let i = 0;
    if (timer.current) clearInterval(timer.current);
    timer.current = setInterval(() => {
      i += 1;
      setReveal(i);
      if (i >= order.length && timer.current) clearInterval(timer.current);
    }, 55);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [order.length, graph]);

  const revealed = useMemo(() => new Set(order.slice(0, reveal)), [order, reveal]);

  // Cascade: a pulsing tool lights everything it can reach.
  const lit = useMemo(() => {
    const set = new Set<string>();
    for (const id of pulse ?? []) {
      set.add(id);
      for (const e of graph.edges) {
        if (e.from === id) set.add(e.to);
        if (e.to === id) set.add(e.from);
      }
    }
    return set;
  }, [pulse, graph]);

  const pathSet = useMemo(() => {
    if (!selected || !paths) return new Set<string>();
    return new Set(paths.get(selected) ?? [selected]);
  }, [selected, paths]);

  const focus = hover ?? selected;
  const degree = useMemo(() => {
    const d = new Map<string, number>();
    for (const e of graph.edges) {
      d.set(e.from, (d.get(e.from) ?? 0) + 1);
      d.set(e.to, (d.get(e.to) ?? 0) + 1);
    }
    return d;
  }, [graph]);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const n of graph.nodes) {
      const lvl = impact?.get(n.id);
      if (lvl) c[lvl] = (c[lvl] ?? 0) + 1;
    }
    return c;
  }, [graph, impact]);

  const dimmed = (id: string): boolean => {
    if (filter && (impact?.get(id) ?? "none") !== filter) return true;
    if (pathSet.size > 0 && !pathSet.has(id)) return true;
    return false;
  };

  const hovered = focus ? positions.get(focus) : null;

  return (
    <div className="impact-graph" style={{ height }}>
      <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`}>
        <defs>
          <radialGradient id="igGlow" cx="50%" cy="50%" r="55%">
            <stop offset="0%" stopColor="#eb7d00" stopOpacity="0.16" />
            <stop offset="100%" stopColor="#eb7d00" stopOpacity="0" />
          </radialGradient>
        </defs>
        <rect width={W} height={H} fill="url(#igGlow)" />

        {/* edges */}
        {graph.edges.map((e) => {
          const a = positions.get(e.from);
          const b = positions.get(e.to);
          if (!a || !b) return null;
          if (!revealed.has(e.from) || !revealed.has(e.to)) return null;

          const active = focus === e.from || focus === e.to || (pulse?.has(e.from) ?? false) || (pulse?.has(e.to) ?? false);
          const color = KIND_COLOR[a.node.kind] ?? "#2a2f20";
          const faded = dimmed(e.from) && dimmed(e.to);
          return (
            <line
              key={e.id}
              className="ig-edge"
              x1={a.x} y1={a.y} x2={b.x} y2={b.y}
              stroke={color}
              strokeWidth={active ? 2.6 : 1.2}
              opacity={faded ? 0.06 : active ? 0.95 : 0.3}
              strokeDasharray={active ? undefined : "3 4"}
            />
          );
        })}

        {/* nodes */}
        {order.map((id, index) => {
          const p = positions.get(id);
          if (!p || !revealed.has(id)) return null;
          const { node } = p;
          const level = impact?.get(id);
          const color = level ? (IMPACT_COLOR[level] ?? IMPACT_COLOR.none) : (KIND_COLOR[node.kind] ?? "#9aa088");
          const isRoot = node.kind === "agent";
          const r = isRoot ? 30 : p.ring === 1 ? 13 : 16;
          const isPulsing = pulse?.has(id);
          const isLit = lit.has(id);
          const isFocus = focus === id;
          const faded = dimmed(id);

          return (
            <g
              key={id}
              className="ig-node-in"
              style={{ animationDelay: `${Math.min(index * 12, 240)}ms`, cursor: "pointer" }}
              onMouseEnter={() => setHover(id)}
              onMouseLeave={() => setHover(null)}
              onClick={() => onSelect?.(selected === id ? null : id)}
            >
              {(isPulsing || isLit) && <circle className="node-halo" cx={p.x} cy={p.y} r={r} fill={color} opacity={0.45} />}
              {isRoot && <circle cx={p.x} cy={p.y} r={r + 9} fill="none" stroke={color} opacity={0.28} />}
              <circle
                cx={p.x} cy={p.y} r={r}
                fill="#0b0d09"
                stroke={color}
                strokeWidth={isFocus || isPulsing ? 3.4 : 2.2}
                opacity={faded ? 0.22 : 1}
              />
              <text x={p.x} y={p.y + 3.5} textAnchor="middle" fontSize={isRoot ? 9 : 10} fill={color} opacity={faded ? 0.3 : 1}>
                {KIND_GLYPH[node.kind] ?? "●"}
              </text>
              <text
                x={p.x}
                y={p.y + r + 12}
                textAnchor="middle"
                className="ig-label"
                fill={faded ? "#4c5344" : "#c9c6b4"}
              >
                {node.label.length > 17 ? node.label.slice(0, 16) + "…" : node.label}
              </text>
            </g>
          );
        })}

        {/* tooltip drawn in SVG so it always aligns */}
        {hovered && revealed.has(hovered.node.id) && (
          <g className="ig-tip" pointerEvents="none">
            {(() => {
              const label = hovered.node.label;
              const w = Math.max(130, label.length * 6.4 + 24);
              const x = Math.min(Math.max(hovered.x - w / 2, 4), W - w - 4);
              const y = Math.max(6, hovered.y - 62);
              const level = impact?.get(hovered.node.id);
              return (
                <>
                  <rect x={x} y={y} width={w} height={46} rx={7} fill="#0f120c" stroke="#3a4129" />
                  <text x={x + 10} y={y + 17} fontSize={10.5} fill="#ebe3a7" fontWeight={700}>
                    {label.length > 24 ? label.slice(0, 23) + "…" : label}
                  </text>
                  <text x={x + 10} y={y + 31} fontSize={9} fill="#8f9a82" fontFamily="monospace">
                    {hovered.node.kind} · {degree.get(hovered.node.id) ?? 0} link(s)
                  </text>
                  <text x={x + 10} y={y + 42} fontSize={9} fill={level ? IMPACT_COLOR[level] : "#8f9a82"} fontWeight={700}>
                    {level ? `impact: ${level}` : "no reachable impact"}
                  </text>
                </>
              );
            })()}
          </g>
        )}
      </svg>

      {showLegend && (
        <div className="impact-legend interactive">
          {IMPACT_ORDER.filter((k) => counts[k]).map((k) => (
            <button
              key={k}
              type="button"
              className={`legend-chip${filter === k ? " active" : ""}`}
              onClick={() => setFilter(filter === k ? null : k)}
            >
              <span className="dot" style={{ background: IMPACT_COLOR[k] }} />
              {counts[k]} {k}
            </button>
          ))}
          <span className="faint tiny">
            {revealed.size}/{order.length} drawn · {selected ? "click again to unpin" : "click a node to pin"}
          </span>
        </div>
      )}
    </div>
  );
}
