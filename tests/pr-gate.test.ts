import { describe, expect, it, vi } from "vitest";
import type { AgentManifest, PermissionScope, ToolDefinition } from "@agentguard/contracts";
import {
  PR_GATE_MARKER,
  buildCheckRunPayload,
  evaluateGate,
  formatPrComment,
  postPrComment,
} from "../services/api/src/pr-gate.js";

function scope(over: Partial<PermissionScope> = {}): PermissionScope {
  return {
    id: "s1",
    resource: "db",
    action: "read",
    dataClass: "internal",
    approvalRequired: false,
    granted: true,
    ...over,
  };
}

function tool(name: string, over: Partial<ToolDefinition> = {}): ToolDefinition {
  return {
    id: `tol_${name}`,
    name,
    description: "",
    inputSchema: {},
    scopes: [],
    sideEffect: "none",
    dataClasses: [],
    edge: "EXECUTE",
    targets: [],
    external: false,
    approvalRequired: false,
    evidenceBacked: false,
    ...over,
  };
}

function manifest(over: Partial<AgentManifest> = {}): AgentManifest {
  return {
    id: "agt_1",
    name: "Acme Assistant",
    purpose: "",
    model: "unknown",
    version: "0.0.0",
    description: "",
    owner: "unknown",
    environment: "sandbox",
    tools: [],
    scopes: [],
    mcpServers: [],
    externalConnectivity: false,
    sourceRef: "inline",
    ...over,
  };
}

describe("PR gate evaluation", () => {
  it("concludes failure when any result is FAIL", () => {
    const gate = evaluateGate({
      base: manifest(),
      head: manifest(),
      affectedTraps: ["sensitive-data"],
      results: [
        { trapId: "sensitive-data", status: "PASS" },
        { trapId: "data-extraction", status: "FAIL" },
      ],
    });
    expect(gate.conclusion).toBe("failure");
    expect(gate.counts).toEqual({ pass: 1, warn: 0, fail: 1 });
  });

  it("concludes failure on ERROR too", () => {
    const gate = evaluateGate({
      base: manifest(),
      head: manifest(),
      affectedTraps: ["sensitive-data"],
      results: [{ trapId: "sensitive-data", status: "ERROR" }],
    });
    expect(gate.conclusion).toBe("failure");
  });

  it("concludes success on a clean run", () => {
    const gate = evaluateGate({
      base: manifest(),
      head: manifest(),
      affectedTraps: ["a", "b"],
      results: [
        { trapId: "a", status: "PASS" },
        { trapId: "b", status: "WARN" },
      ],
    });
    expect(gate.conclusion).toBe("success");
    expect(gate.counts).toEqual({ pass: 1, warn: 1, fail: 0 });
  });

  it("lists the added tools and permissions the drift comparator found", () => {
    const baseManifest = manifest({ tools: [tool("read_tx")], scopes: [scope()] });
    const headManifest = manifest({
      tools: [tool("read_tx"), tool("export_data")],
      scopes: [scope(), scope({ id: "s2", resource: "crm", action: "write", dataClass: "pii" })],
    });
    const gate = evaluateGate({
      base: baseManifest,
      head: headManifest,
      affectedTraps: [],
      results: [],
    });
    expect(gate.newCapabilities).toContain("export_data");
    expect(gate.newCapabilities).toContain("crm:write");
    expect(gate.newCapabilities).not.toContain("read_tx");
  });
});

describe("PR gate rendering", () => {
  it("starts the comment with the invisible marker", () => {
    const gate = evaluateGate({
      base: manifest(),
      head: manifest(),
      affectedTraps: ["sensitive-data"],
      results: [{ trapId: "sensitive-data", status: "FAIL" }],
    });
    const comment = formatPrComment("Acme Assistant", gate);
    expect(comment.split("\n")[0]).toBe(PR_GATE_MARKER);
    expect(comment).toContain("Acme Assistant");
    expect(comment).toContain("sensitive-data");
    expect(comment).not.toMatch(/\bis certified\b/i);
    expect(comment).not.toMatch(/\bsecure\b/i);
  });

  it("builds a check-run payload named 'AgentGuard X PR Gate'", () => {
    const gate = evaluateGate({
      base: manifest(),
      head: manifest(),
      affectedTraps: [],
      results: [{ trapId: "x", status: "PASS" }],
    });
    const payload = buildCheckRunPayload(gate);
    expect(payload.name).toBe("AgentGuard X PR Gate");
    expect(payload.conclusion).toBe("success");
  });
});

describe("postPrComment", () => {
  it("dry-runs without calling an injected fetch when the token is empty", async () => {
    const spy = vi.fn();
    const result = await postPrComment({
      token: "",
      repo: "acme/agents",
      prNumber: 7,
      body: "hello",
      fetchImpl: spy as unknown as typeof fetch,
    });
    expect(spy).not.toHaveBeenCalled();
    expect(result.dryRun).toBe(true);
    expect(result.posted).toBe(false);
  });

  it("creates a comment when none carries the marker", async () => {
    const fetchImpl = (async (_url: unknown, init?: RequestInit) => {
      if (init?.method === "POST") return new Response(JSON.stringify({ id: 42 }), { status: 201 });
      return new Response(JSON.stringify([]), { status: 200 });
    }) as unknown as typeof fetch;

    const result = await postPrComment({
      token: "t",
      repo: "acme/agents",
      prNumber: 7,
      body: "body",
      fetchImpl,
    });
    expect(result).toEqual({ dryRun: false, posted: true, updated: false, id: 42 });
  });

  it("updates the comment that already carries the marker", async () => {
    const existing = { id: 9, body: `${PR_GATE_MARKER}\nold body` };
    let patched = false;
    const fetchImpl = (async (_url: unknown, init?: RequestInit) => {
      if (init?.method === "PATCH") {
        patched = true;
        return new Response(JSON.stringify(existing), { status: 200 });
      }
      return new Response(JSON.stringify([existing]), { status: 200 });
    }) as unknown as typeof fetch;

    const result = await postPrComment({
      token: "t",
      repo: "acme/agents",
      prNumber: 7,
      body: "new body",
      fetchImpl,
    });
    expect(patched).toBe(true);
    expect(result).toEqual({ dryRun: false, posted: true, updated: true, id: 9 });
  });
});
