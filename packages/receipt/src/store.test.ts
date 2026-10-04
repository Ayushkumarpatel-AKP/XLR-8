import { mkdtempSync, rmSync, writeFileSync, appendFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { Receipt } from "./shared.js";
import { createFileReceiptStore, createMemoryReceiptStore } from "./store.js";

/** Only the fields the store keys on are real; the rest never reaches it. */
const receipt = (fingerprint: string, agentId: string, issuedAt: string): Receipt =>
  ({ fingerprint, agentId, issuedAt, identity: agentId, agentName: agentId }) as unknown as Receipt;

const dir = mkdtempSync(join(tmpdir(), "agx-receipts-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("receipt store", () => {
  it("returns nothing for a workspace with no receipts", () => {
    const store = createMemoryReceiptStore();
    expect(store.all()).toEqual([]);
    expect(store.forAgent("nobody")).toEqual([]);
    expect(store.byFingerprint("sha256:nope")).toBeNull();
  });

  it("hands back the newest receipt first, whatever order they arrived in", () => {
    const store = createMemoryReceiptStore();
    store.record(receipt("fp_old", "agent-a", "2026-01-01T00:00:00.000Z"));
    store.record(receipt("fp_new", "agent-a", "2026-03-01T00:00:00.000Z"));
    store.record(receipt("fp_mid", "agent-b", "2026-02-01T00:00:00.000Z"));

    expect(store.all().map((r) => r.fingerprint)).toEqual(["fp_mid", "fp_new", "fp_old"]);
  });

  it("filters to one agent, so a page never shows another agent's receipt", () => {
    const store = createMemoryReceiptStore();
    store.record(receipt("fp_a", "agent-a", "2026-01-01T00:00:00.000Z"));
    store.record(receipt("fp_b", "agent-b", "2026-01-02T00:00:00.000Z"));

    expect(store.forAgent("agent-a").map((r) => r.fingerprint)).toEqual(["fp_a"]);
    expect(store.forAgent("agent-b").map((r) => r.fingerprint)).toEqual(["fp_b"]);
  });

  it("finds a receipt by fingerprint", () => {
    const store = createMemoryReceiptStore([receipt("fp_one", "agent-a", "2026-01-01T00:00:00.000Z")]);
    expect(store.byFingerprint("fp_one")?.agentId).toBe("agent-a");
    expect(store.byFingerprint("fp_absent")).toBeNull();
  });

  it("survives being closed and opened again — the whole point of keeping it", () => {
    const path = join(dir, "receipts.jsonl");
    createFileReceiptStore(path).record(receipt("fp_persisted", "agent-a", "2026-01-01T00:00:00.000Z"));

    const reopened = createFileReceiptStore(path);
    expect(reopened.all().map((r) => r.fingerprint)).toEqual(["fp_persisted"]);
    expect(reopened.byFingerprint("fp_persisted")?.agentId).toBe("agent-a");
  });

  it("skips a corrupt line rather than losing the whole history", () => {
    const path = join(dir, "corrupt.jsonl");
    const store = createFileReceiptStore(path);
    store.record(receipt("fp_good", "agent-a", "2026-01-01T00:00:00.000Z"));
    appendFileSync(path, "{ this is not json\n", "utf8");
    appendFileSync(path, JSON.stringify({ unrelated: true }) + "\n", "utf8");
    store.record(receipt("fp_also_good", "agent-a", "2026-01-02T00:00:00.000Z"));

    expect(store.all().map((r) => r.fingerprint)).toEqual(["fp_also_good", "fp_good"]);
  });

  it("appends rather than rewriting, so an earlier receipt is never lost", () => {
    const path = join(dir, "append.jsonl");
    const store = createFileReceiptStore(path);
    store.record(receipt("fp_1", "agent-a", "2026-01-01T00:00:00.000Z"));
    const afterFirst = readFileSync(path, "utf8");
    store.record(receipt("fp_2", "agent-a", "2026-01-02T00:00:00.000Z"));

    expect(readFileSync(path, "utf8").startsWith(afterFirst)).toBe(true);
  });

  it("reads an empty file as no receipts", () => {
    const path = join(dir, "empty.jsonl");
    writeFileSync(path, "", "utf8");
    expect(createFileReceiptStore(path).all()).toEqual([]);
  });
});
