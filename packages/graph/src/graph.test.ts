import { describe, expect, it } from "vitest";
import type { AgentManifest } from "@agentguard/contracts";
import { buildCapabilityGraph, computeBlastRadius } from "./index.js";

const manifest: AgentManifest = {
  id: "agent-1",
  name: "Test Agent",
  purpose: "",
  model: "test",
  version: "1.0.0",
  description: "",
  owner: "test",
  environment: "sandbox",
  mcpServers: ["srv"],
  externalConnectivity: true,
  sourceRef: "test",
  scopes: [],
  tools: [
    {
      id: "t1",
      name: "refund_payment",
      description: "refund",
      mcpServer: "srv",
      inputSchema: {},
      scopes: [],
      sideEffect: "write",
      dataClasses: ["financial"],
      edge: "FINANCIAL",
      external: false,
      approvalRequired: true,
      evidenceBacked: true,
      targets: [{ id: "payment_api", kind: "payment", label: "Payment API", edge: "FINANCIAL" }],
    },
    {
      id: "t2",
      name: "send_email",
      description: "email",
      mcpServer: "srv",
      inputSchema: {},
      scopes: [],
      sideEffect: "write",
      dataClasses: ["internal"],
      edge: "SEND",
      external: true,
      approvalRequired: false,
      evidenceBacked: true,
      targets: [{ id: "email_service", kind: "email", label: "Email Service", edge: "SEND" }],
    },
  ],
};

describe("capability graph", () => {
  it("creates agent, tool and target nodes with edges", () => {
    const graph = buildCapabilityGraph(manifest);
    expect(graph.nodes.some((n) => n.id === "agent-1" && n.kind === "agent")).toBe(true);
    expect(graph.nodes.some((n) => n.id === "tool:refund_payment")).toBe(true);
    expect(graph.nodes.some((n) => n.id === "payment_api")).toBe(true);
    expect(graph.edges.length).toBeGreaterThanOrEqual(4);
  });

  it("computes a blast radius without executing anything", () => {
    const graph = buildCapabilityGraph(manifest);
    const blast = computeBlastRadius(graph);
    const payment = blast.reachable.find((r) => r.nodeId === "payment_api");
    expect(payment).toBeDefined();
    expect(payment?.impact).toBe("critical");
    expect(blast.affectedDomains).toContain("money");
  });

  it("includes a path from the agent to each reachable node", () => {
    const blast = computeBlastRadius(buildCapabilityGraph(manifest));
    for (const r of blast.reachable) {
      expect(r.path[0]).toBe("agent-1");
      expect(r.path.at(-1)).toBe(r.nodeId);
    }
  });
});
