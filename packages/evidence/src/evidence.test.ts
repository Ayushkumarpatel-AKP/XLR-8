import { describe, expect, it } from "vitest";
import { EvidenceStore, digestContent } from "./index.js";

describe("evidence store", () => {
  it("captures records with a content digest", () => {
    const store = new EvidenceStore();
    const rec = store.capture({
      missionId: "mis_1",
      executionId: "exe_1",
      source: "tool_call",
      sourceRef: "refund_payment",
      summary: "refund executed",
      content: { amount: 100 },
    });
    expect(rec.contentDigest).toMatch(/^sha256:/);
    expect(store.verifyIntegrity().ok).toBe(true);
  });

  it("is tamper-evident: mutating stored content breaks integrity", () => {
    const store = new EvidenceStore();
    const rec = store.capture({
      missionId: "mis_1",
      executionId: "exe_1",
      source: "tool_call",
      sourceRef: "x",
      summary: "x",
      content: { amount: 100 },
    });
    (rec.content as { amount: number }).amount = 999;
    const check = store.verifyIntegrity();
    expect(check.ok).toBe(false);
    expect(check.failures).toContain(rec.id);
  });

  it("snapshots content so later mutation of the source object is harmless", () => {
    const store = new EvidenceStore();
    const source = { amount: 100, nested: { a: 1 } };
    store.capture({
      missionId: "mis_1",
      executionId: "exe_1",
      source: "tool_call",
      sourceRef: "x",
      summary: "x",
      content: source,
    });
    source.amount = 500;
    source.nested.a = 2;
    expect(store.verifyIntegrity().ok).toBe(true);
  });

  it("produces stable digests regardless of key order", () => {
    expect(digestContent({ a: 1, b: 2 })).toBe(digestContent({ b: 2, a: 1 }));
  });
});
