import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { loadState, saveState, statePath } from "./persistence.js";

const dir = mkdtempSync(join(tmpdir(), "agx-persist-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const write = (name: string, state: unknown) => {
  const d = join(dir, name);
  mkdirSync(d, { recursive: true });
  writeFileSync(statePath(d), JSON.stringify(state), "utf8");
  return d;
};

/** The shape the old /api/agents/import wrote: tools without the schema defaults. */
const legacyAgent = {
  id: "legacy-import",
  name: "Legacy Import",
  tools: [{ id: "l0", name: "legacy_tool_0", description: "", external: true }],
};

describe("persisted state", () => {
  it("returns null when there is nothing saved", () => {
    expect(loadState(join(dir, "absent"))).toBeNull();
  });

  it("round-trips a workspace", () => {
    const d = join(dir, "roundtrip");
    const manifest = {
      id: "agent",
      name: "Agent",
      tools: [{ id: "t0", name: "tool_0", description: "", dataClasses: ["pii"] as const }],
    };
    saveState(d, [], [], [manifest as never], []);
    const loaded = loadState(d);
    expect(loaded?.agents.map((a) => a.id)).toEqual(["agent"]);
  });

  /**
   * The defect this guards: a manifest written before a field existed reached
   * code that assumed the schema held. `tool.targets` was iterated, `dataClasses`
   * was read, and both threw — taking a whole screen down. Reading it back
   * through the schema fills the defaults in once, at the boundary.
   */
  it("repairs an older manifest by applying the schema defaults", () => {
    const d = write("legacy", { version: 3, missions: [], evidence: [], agents: [legacyAgent], baselines: [] });
    const agent = loadState(d)?.agents[0]!;

    expect(agent.id).toBe("legacy-import");
    const tool = agent.tools[0]!;
    expect(tool.targets).toEqual([]);
    expect(tool.dataClasses).toEqual([]);
    expect(tool.edge).toBe("EXECUTE");
    expect(tool.sideEffect).toBe("none");
    expect(tool.external).toBe(true);
    expect(agent.environment).toBe("sandbox");
  });

  it("never drops an agent it cannot parse — it keeps it as it was", () => {
    const unknown = { id: "mystery", name: "Mystery", environment: "not-a-real-environment" };
    const d = write("unparseable", { version: 3, missions: [], evidence: [], agents: [unknown], baselines: [] });
    const agents = loadState(d)?.agents ?? [];

    expect(agents).toHaveLength(1);
    expect(agents[0]).toEqual(unknown);
  });

  it("ignores state written by an incompatible version", () => {
    const d = write("oldversion", { version: 1, missions: [], evidence: [], agents: [legacyAgent] });
    expect(loadState(d)).toBeNull();
  });

  it("survives a corrupt file rather than taking the process down", () => {
    const d = join(dir, "corrupt");
    mkdirSync(d, { recursive: true });
    writeFileSync(statePath(d), "{ not json at all", "utf8");
    expect(loadState(d)).toBeNull();
  });
});
