import { describe, expect, it } from "vitest";
import { defaultPolicySet, evaluatePolicy, type PolicyInput } from "./index.js";

const rules = defaultPolicySet().rules;

const base: PolicyInput = {
  toolName: "read_thing",
  edge: "READ",
  sideEffect: "read",
  dataClasses: [],
  external: false,
  approvalRequired: false,
  risk: 0,
};

describe("deterministic policy engine", () => {
  it("requires approval for financial actions", () => {
    const result = evaluatePolicy(rules, { ...base, toolName: "refund_payment", edge: "FINANCIAL" });
    expect(result.outcome).toBe("REQUIRE_APPROVAL");
    expect(result.matchedRule?.id).toBe("pol_financial_approval");
  });

  it("denies device control", () => {
    const result = evaluatePolicy(rules, { ...base, toolName: "unlock_door", edge: "DEVICE_CONTROL" });
    expect(result.outcome).toBe("DENY");
  });

  it("denies secret egress", () => {
    const result = evaluatePolicy(rules, {
      ...base,
      toolName: "post_secret",
      dataClasses: ["secret"],
      external: true,
      sideEffect: "write",
      edge: "WRITE",
    });
    expect(result.outcome).toBe("DENY");
  });

  it("gates PII access", () => {
    const result = evaluatePolicy(rules, { ...base, toolName: "get_profile", dataClasses: ["pii"] });
    expect(result.outcome).toBe("REQUIRE_APPROVAL");
    expect(result.matchedRule?.id).toBe("pol_pii_gate");
  });

  it("warns on unchecked external egress", () => {
    const result = evaluatePolicy(rules, {
      ...base,
      toolName: "send_webhook",
      edge: "NETWORK",
      sideEffect: "write",
      external: true,
    });
    expect(result.outcome).toBe("WARN");
  });

  it("allows an ordinary read", () => {
    const result = evaluatePolicy(rules, { ...base, toolName: "list_tickets", dataClasses: ["internal"] });
    expect(result.outcome).toBe("ALLOW");
    expect(result.matchedRule).toBeNull();
  });

  it("is deterministic: identical input yields identical decision", () => {
    const input: PolicyInput = { ...base, toolName: "refund_payment", edge: "FINANCIAL" };
    expect(evaluatePolicy(rules, input)).toEqual(evaluatePolicy(rules, input));
  });

  it("always explains which rule matched", () => {
    const result = evaluatePolicy(rules, { ...base, toolName: "refund_payment", edge: "FINANCIAL" });
    expect(result.reason.length).toBeGreaterThan(0);
    expect(result.matchedRule).not.toBeNull();
  });
});
