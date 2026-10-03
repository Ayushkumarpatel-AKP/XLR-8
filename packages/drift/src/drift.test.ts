import { describe, expect, it } from "vitest";
import type { AgentSnapshot, PermissionScope } from "@agentguard/contracts";
import { compareSnapshots } from "./index.js";

function snap(id: string, tools: string[], scopes: PermissionScope[], external: string[]): AgentSnapshot {
  return { id, agentId: "agent-1", label: id, capturedAt: "2025-01-01T00:00:00.000Z", toolNames: tools, scopes, externalDestinations: external, contentDigest: "d" };
}

const refundScope: PermissionScope = { id: "s1", resource: "payment_api", action: "refund", dataClass: "financial", approvalRequired: true, granted: true };

describe("drift comparator", () => {
  it("reports no changes for identical snapshots", () => {
    const a = snap("A", ["get_tx", "refund"], [refundScope], []);
    const b = snap("B", ["get_tx", "refund"], [refundScope], []);
    expect(compareSnapshots(a, b).changes).toHaveLength(0);
  });

  it("detects added tools and external destinations", () => {
    const a = snap("A", ["get_tx"], [refundScope], []);
    const b = snap("B", ["get_tx", "export_data"], [refundScope], ["export_data"]);
    const drift = compareSnapshots(a, b);
    expect(drift.changes.some((c) => c.kind === "tool_added" && c.subject === "export_data")).toBe(true);
    expect(drift.changes.some((c) => c.kind === "external_destination_added")).toBe(true);
    expect(drift.riskDelta).toBeGreaterThan(0);
  });

  it("detects a removed approval gate", () => {
    const a = snap("A", ["refund"], [refundScope], []);
    const b = snap("B", ["refund"], [{ ...refundScope, approvalRequired: false }], []);
    const drift = compareSnapshots(a, b);
    expect(drift.changes.some((c) => c.kind === "approval_removed")).toBe(true);
  });

  it("detects a widened data-class scope", () => {
    const a = snap("A", ["read"], [{ id: "s", resource: "db", action: "read", dataClass: "internal", approvalRequired: false, granted: true }], []);
    const b = snap("B", ["read"], [{ id: "s", resource: "db", action: "read", dataClass: "pii", approvalRequired: false, granted: true }], []);
    const drift = compareSnapshots(a, b);
    expect(drift.changes.some((c) => c.kind === "scope_widened")).toBe(true);
    expect(drift.changes.some((c) => c.kind === "sensitive_data_access_added")).toBe(false);
  });
});
