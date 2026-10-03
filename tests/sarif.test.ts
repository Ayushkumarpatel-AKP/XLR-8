import { describe, expect, it } from "vitest";
import type { Finding, Severity } from "@agentguard/contracts";
import { SARIF_SCHEMA, SARIF_VERSION, severityToLevel, toSarif } from "@agentguard/sarif";

function finding(over: Partial<Finding> = {}): Finding {
  return {
    id: "fnd_1",
    missionId: "mis_1",
    title: "Title",
    category: "data-exfiltration",
    severity: "high",
    status: "open",
    agentId: "agt_1",
    toolName: null,
    policyRuleId: null,
    description: "Description",
    recommendation: "Recommendation",
    evidenceIds: ["evd_1"],
    citation: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...over,
  };
}

const base = {
  agentId: "agt_1",
  agentName: "Acme Assistant",
  sourceRef: "agents/acme.yaml",
  missionId: "mis_1",
};

describe("SARIF export", () => {
  it("emits a valid 2.1.0 document with one run", () => {
    const log = toSarif({ ...base, findings: [finding()] });
    expect(log.version).toBe(SARIF_VERSION);
    expect(log.$schema).toBe(SARIF_SCHEMA);
    expect(log.runs).toHaveLength(1);
    expect(log.runs[0]?.tool.driver.name).toBe("AgentGuard X");
    expect(log.runs[0]?.tool.driver.version).toBeTruthy();
    expect(log.runs[0]?.tool.driver.informationUri).toContain("http");
  });

  it("emits one rule per distinct category, sorted", () => {
    const log = toSarif({
      ...base,
      findings: [
        finding({ id: "a", category: "scope-creep" }),
        finding({ id: "b", category: "data-exfiltration" }),
        finding({ id: "c", category: "scope-creep" }),
      ],
    });
    const rules = log.runs[0]?.tool.driver.rules ?? [];
    expect(rules.map((r) => r.id)).toEqual(["data-exfiltration", "scope-creep"]);
    for (const rule of rules) {
      expect(rule.shortDescription.text.length).toBeGreaterThan(0);
      expect(rule.helpUri).toBeUndefined();
    }
  });

  it("maps all five severities to the right level", () => {
    const expected: Record<Severity, string> = {
      critical: "error",
      high: "error",
      medium: "warning",
      low: "note",
      info: "note",
    };
    for (const severity of Object.keys(expected) as Severity[]) {
      expect(severityToLevel(severity)).toBe(expected[severity]);
    }
  });

  it("sorts results critical-first then by title", () => {
    const log = toSarif({
      ...base,
      findings: [
        finding({ id: "a", title: "info one", severity: "info" }),
        finding({ id: "b", title: "medium one", severity: "medium" }),
        finding({ id: "c", title: "critical z", severity: "critical" }),
        finding({ id: "d", title: "critical a", severity: "critical" }),
        finding({ id: "e", title: "low one", severity: "low" }),
      ],
    });
    const results = log.runs[0]?.results ?? [];
    expect(results.map((r) => r.level)).toEqual(["error", "error", "warning", "note", "note"]);
    expect(results[0]?.properties.severity).toBe("critical");
    expect(results[1]?.properties.severity).toBe("critical");
    expect(results[0]?.message.text).toContain("critical a");
    expect(results[1]?.message.text).toContain("critical z");
  });

  it("carries the citation quote in properties when present", () => {
    const log = toSarif({
      ...base,
      findings: [
        finding({
          citation: { evidenceId: "evd_1", quote: "the agent leaked aarav@example.test", where: "reply" },
        }),
      ],
    });
    const result = log.runs[0]?.results[0];
    expect(result?.properties.citationQuote).toBe("the agent leaked aarav@example.test");
    expect(result?.properties.agentId).toBe("agt_1");
    expect(result?.properties.missionId).toBe("mis_1");
  });

  it("uses agentguard://<id> when sourceRef is empty and line 1 always", () => {
    const log = toSarif({ ...base, sourceRef: "", findings: [finding()] });
    const location = log.runs[0]?.results[0]?.locations[0]?.physicalLocation;
    expect(location?.artifactLocation.uri).toBe("agentguard://agt_1");
    expect(location?.region.startLine).toBe(1);
  });

  it("still produces a valid log with zero findings", () => {
    const log = toSarif({ ...base, findings: [] });
    expect(log.version).toBe(SARIF_VERSION);
    expect(log.runs[0]?.results).toEqual([]);
    expect(log.runs[0]?.tool.driver.rules).toEqual([]);
  });
});
