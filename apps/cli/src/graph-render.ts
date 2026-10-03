import type { CapabilityGraph, GraphNode } from "@agentguard/contracts";
import type { Line } from "./kind.js";

/* ------------------------------------------------------------------ *
 * A genuine terminal graph renderer.
 *
 * Nodes are plotted on a character grid and wired together with real
 * box-drawing edges (orthogonal routing over a bus), coloured by node
 * kind / impact and by edge kind. Supports an animated reveal via
 * `stage`, and impact tinting for the blast-radius view.
 *
 *     ◉ AGENT ─────────┬──── ◆ tool ────┬──── ▤ Data Store
 *                      │                └──── $ Payment API
 *                      └──── ◆ tool ────────── ✉ Email Service
 * ------------------------------------------------------------------ */

const KIND_COLOR: Record<string, string> = {
  agent: "38;5;208",
  tool: "38;5;74",
  mcp_server: "38;5;245",
  data_store: "38;5;179",
  api: "38;5;80",
  payment: "38;5;167",
  email: "38;5;170",
  crm: "38;5;114",
  iot: "38;5;167",
  external_service: "38;5;215",
};

const KIND_GLYPH: Record<string, string> = {
  agent: "◉",
  tool: "◆",
  mcp_server: "◈",
  data_store: "▤",
  api: "⬡",
  payment: "$",
  email: "✉",
  crm: "▣",
  iot: "⌂",
  external_service: "▲",
};

const EDGE_COLOR: Record<string, string> = {
  READ: "38;5;74",
  WRITE: "38;5;179",
  EXECUTE: "38;5;243",
  SEND: "38;5;170",
  NETWORK: "38;5;215",
  FINANCIAL: "38;5;167",
  DEVICE_CONTROL: "38;5;167",
  TRUST: "38;5;114",
};

const IMPACT_COLOR: Record<string, string> = {
  critical: "38;5;167",
  high: "38;5;215",
  medium: "38;5;179",
  low: "38;5;74",
  none: "38;5;243",
};

const RESET = "\x1b[0m";
const DIM = "38;5;240";
const MAX_LABEL = 16;

interface Cell {
  ch: string;
  color?: string;
}

class Canvas {
  private readonly grid: Cell[][];

  constructor(
    readonly width: number,
    readonly height: number,
  ) {
    this.grid = Array.from({ length: height }, () =>
      Array.from({ length: width }, () => ({ ch: " " }) as Cell),
    );
  }

  put(x: number, y: number, ch: string, color?: string): void {
    const xi = Math.round(x);
    const yi = Math.round(y);
    if (xi < 0 || yi < 0 || xi >= this.width || yi >= this.height) return;
    const cell = this.grid[yi]?.[xi];
    if (!cell) return;
    cell.ch = ch;
    cell.color = color;
  }

  text(x: number, y: number, s: string, color?: string): void {
    for (let i = 0; i < s.length; i++) this.put(x + i, y, s[i] ?? " ", color);
  }

  hLine(x0: number, x1: number, y: number, color?: string): void {
    const from = Math.min(x0, x1);
    const to = Math.max(x0, x1);
    for (let x = from; x <= to; x++) this.put(x, y, "─", color);
  }

  vLine(x: number, y0: number, y1: number, color?: string): void {
    const from = Math.min(y0, y1);
    const to = Math.max(y0, y1);
    for (let y = from; y <= to; y++) this.put(x, y, "│", color);
  }

  render(): string[] {
    return this.grid.map((row) => {
      let out = "";
      let current: string | undefined;
      for (const cell of row) {
        if (cell.color !== current) {
          out += cell.color ? `\x1b[${cell.color}m` : RESET;
          current = cell.color;
        }
        out += cell.ch;
      }
      return (out + RESET).replace(/\s+$/, "");
    });
  }
}

export interface GraphRenderOptions {
  width: number;
  height: number;
  /** 1 = agent, 2 = + tools, 3 = + services (reveal animation). */
  stage?: 1 | 2 | 3;
  /** Node ids to emphasise. */
  highlight?: string[];
  /** Node id → impact level, for the blast-radius view. */
  impact?: Map<string, string>;
  /** Dim nodes that are neither highlighted nor impacted. */
  dimRest?: boolean;
  /** Draw text labels next to glyphs. */
  labels?: boolean;
}

interface Columns {
  colA: number;
  colB: number;
  trunkBC: number;
  colC: number;
}

function columns(width: number): Columns {
  const colA = 2;
  const colB = Math.max(16, Math.round(width * 0.28));
  const colC = Math.max(colB + 24, Math.round(width * 0.68));
  const trunkBC = Math.max(colB + MAX_LABEL + 4, colC - 8);
  return { colA, colB, trunkBC, colC };
}

function rows(count: number, height: number): number[] {
  if (count === 0) return [];
  const top = 1;
  const bottom = Math.max(top, height - 2);
  return Array.from({ length: count }, (_, i) => Math.round(top + ((i + 1) * (bottom - top)) / (count + 1)));
}

function labelOf(node: GraphNode): string {
  return node.label.length > MAX_LABEL ? node.label.slice(0, MAX_LABEL - 1) + "…" : node.label;
}

function nodeColor(node: GraphNode, opts: GraphRenderOptions, highlight: Set<string>): string {
  if (opts.impact?.has(node.id)) return IMPACT_COLOR[opts.impact.get(node.id) ?? "none"] ?? DIM;
  if (opts.dimRest && highlight.size > 0 && !highlight.has(node.id) && node.kind !== "agent") return DIM;
  return KIND_COLOR[node.kind] ?? DIM;
}

/** Render the capability/trust graph as coloured terminal lines. */
export function renderGraphLines(graph: CapabilityGraph, opts: GraphRenderOptions): Line[] {
  const { width, height } = opts;
  const stage = opts.stage ?? 3;
  const labels = opts.labels ?? true;
  const highlight = new Set(opts.highlight ?? []);
  const canvas = new Canvas(width, height);
  const { colA, colB, trunkBC, colC } = columns(width);

  const root = graph.nodes.find((n) => n.id === graph.agentId) ?? graph.nodes[0];
  const tools = graph.nodes
    .filter((n) => n.kind === "tool" || n.kind === "mcp_server")
    .sort((a, b) => a.label.localeCompare(b.label));
  const leaves = graph.nodes
    .filter((n) => n !== root && !tools.includes(n))
    .sort((a, b) => a.kind.localeCompare(b.kind) || a.label.localeCompare(b.label));

  const agentY = Math.floor(height / 2);
  const toolRows = rows(tools.length, height);
  const leafRows = rows(leaves.length, height);
  const toolY = new Map(tools.map((t, i) => [t.id, toolRows[i] ?? agentY] as const));
  const leafY = new Map(leaves.map((l, i) => [l.id, leafRows[i] ?? agentY] as const));

  const edgesFrom = new Map<string, typeof graph.edges>();
  for (const e of graph.edges) {
    const list = edgesFrom.get(e.from) ?? [];
    list.push(e);
    edgesFrom.set(e.from, list);
  }

  const trunkAB = colA + 8;

  // --- edges: agent → tools (stage 2) ---
  if (stage >= 2 && root) {
    const toolEdges = (edgesFrom.get(root.id) ?? []).filter((e) => toolY.has(e.to));
    if (toolEdges.length > 0) {
      canvas.hLine(colA + 1, trunkAB, agentY, DIM);
      if (toolEdges.length > 1) canvas.vLine(trunkAB, agentY, toolRows[toolRows.length - 1] ?? agentY, DIM);
    }
    for (const e of toolEdges) {
      const y = toolY.get(e.to) ?? agentY;
      canvas.hLine(trunkAB, colB - 1, y, EDGE_COLOR[e.kind] ?? DIM);
    }
  }

  // --- edges: tools → services (stage 3) ---
  if (stage >= 3) {
    for (const tool of tools) {
      for (const e of edgesFrom.get(tool.id) ?? []) {
        const y1 = toolY.get(tool.id);
        const y2 = leafY.get(e.to);
        if (y1 === undefined || y2 === undefined) continue;
        const active = highlight.size === 0 || highlight.has(e.to) || highlight.has(tool.id);
        const color = active ? EDGE_COLOR[e.kind] ?? DIM : DIM;
        const startX = colB + 2 + labelOf(tool).length + 1;
        canvas.hLine(startX, trunkBC, y1, color);
        canvas.vLine(trunkBC, y1, y2, color);
        canvas.hLine(trunkBC, colC - 1, y2, color);
      }
    }
  }

  // --- nodes ---
  if (root) {
    const color = nodeColor(root, opts, highlight);
    canvas.put(colA, agentY, KIND_GLYPH.agent ?? "◉", color);
    if (labels) canvas.text(colA + 2, agentY, "AGENT", color);
  }
  if (stage >= 2) {
    for (const tool of tools) {
      const y = toolY.get(tool.id) ?? agentY;
      const color = nodeColor(tool, opts, highlight);
      canvas.put(colB, y, KIND_GLYPH[tool.kind] ?? "◆", color);
      if (labels) canvas.text(colB + 2, y, labelOf(tool), color);
    }
  }
  if (stage >= 3) {
    for (const leaf of leaves) {
      const y = leafY.get(leaf.id) ?? agentY;
      const color = nodeColor(leaf, opts, highlight);
      canvas.put(colC, y, KIND_GLYPH[leaf.kind] ?? "●", color);
      if (labels) canvas.text(colC + 2, y, labelOf(leaf), color);
    }
  }

  return canvas.render().map((text) => ({ text, kind: "info" as const, raw: true }));
}

/** A compact legend line for the node kinds present. */
export function graphLegend(graph: CapabilityGraph): Line {
  const present = [...new Set(graph.nodes.map((n) => n.kind))];
  const parts = present.map((k) => `\x1b[${KIND_COLOR[k] ?? DIM}m${KIND_GLYPH[k] ?? "●"} ${k}\x1b[0m`);
  return { text: "  " + parts.join("   "), kind: "dim", raw: true };
}

/** Reveal frames: agent → tools → services. */
export function revealFrames(): Array<{ stage: 1 | 2 | 3; hold: number }> {
  return [
    { stage: 1, hold: 90 },
    { stage: 2, hold: 140 },
    { stage: 3, hold: 0 },
  ];
}
