import { describe, expect, it } from "vitest";
import { buildAcmeBankManifest } from "@agentguard/demo-lab";
import { buildCapabilityGraph } from "@agentguard/graph";
import { graphLegend, renderGraphLines, revealFrames } from "../apps/cli/src/graph-render.js";

const graph = buildCapabilityGraph(buildAcmeBankManifest("v1"));
const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");
const textOf = (lines: { text: string }[]) => lines.map((l) => strip(l.text)).join("\n");

describe("terminal graph renderer", () => {
  it("draws a box of the requested size", () => {
    const lines = renderGraphLines(graph, { width: 100, height: 18 });
    expect(lines).toHaveLength(18);
    for (const line of lines) {
      expect(strip(line.text).length).toBeLessThanOrEqual(100);
    }
    expect(lines.every((l) => l.raw === true)).toBe(true);
  });

  it("plots the agent and every tool", () => {
    const text = textOf(renderGraphLines(graph, { width: 100, height: 18 }));
    expect(text).toContain("AGENT");
    for (const tool of graph.nodes.filter((n) => n.kind === "tool")) {
      const label = tool.label.length > 15 ? tool.label.slice(0, 15) : tool.label;
      expect(text).toContain(label);
    }
  });

  it("connects nodes with real box-drawing edges", () => {
    const text = textOf(renderGraphLines(graph, { width: 100, height: 18 }));
    expect(/[─│]/.test(text)).toBe(true);
  });

  it("reveals progressively: agent → tools → services", () => {
    const stage1 = textOf(renderGraphLines(graph, { width: 100, height: 18, stage: 1 }));
    const stage2 = textOf(renderGraphLines(graph, { width: 100, height: 18, stage: 2 }));
    const stage3 = textOf(renderGraphLines(graph, { width: 100, height: 18, stage: 3 }));

    expect(stage1).toContain("AGENT");
    expect(stage1).not.toContain("refund_payment");

    expect(stage2).toContain("refund_payment");
    expect(stage2).not.toContain("Payment API");

    expect(stage3).toContain("Payment API");
    const ink = (s: string) => s.replace(/\s/g, "").length;
    expect(ink(stage3)).toBeGreaterThan(ink(stage2));
    expect(ink(stage2)).toBeGreaterThan(ink(stage1));
  });

  it("is deterministic", () => {
    const a = renderGraphLines(graph, { width: 100, height: 18 });
    const b = renderGraphLines(graph, { width: 100, height: 18 });
    expect(a.map((l) => l.text)).toEqual(b.map((l) => l.text));
  });

  it("exposes three reveal frames ending on the full graph", () => {
    const frames = revealFrames();
    expect(frames).toHaveLength(3);
    expect(frames[0]?.stage).toBe(1);
    expect(frames[2]?.stage).toBe(3);
  });

  it("renders a legend for the node kinds present", () => {
    const legend = graphLegend(graph);
    expect(legend.raw).toBe(true);
    const text = strip(legend.text);
    expect(text).toContain("agent");
    expect(text).toContain("tool");
  });
});
