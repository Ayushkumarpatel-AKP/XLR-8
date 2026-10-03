import type { Finding, Severity } from "@agentguard/contracts";

/**
 * SARIF 2.1.0 export for AgentGuard X findings.
 *
 * A dependency-free encoder: findings are mapped to a single SARIF run so the
 * same document can be uploaded by `github/codeql-action/upload-sarif` or any
 * other SARIF-aware consumer. No third-party SARIF library is used, and the
 * output is deterministic so identical findings always produce identical bytes.
 */

export type SarifLevel = "error" | "warning" | "note";

export interface SarifMessage {
  text: string;
}

export interface SarifReportingDescriptor {
  id: string;
  name: string;
  shortDescription: SarifMessage;
}

export interface SarifRegion {
  startLine: number;
}

export interface SarifArtifactLocation {
  uri: string;
}

export interface SarifPhysicalLocation {
  artifactLocation: SarifArtifactLocation;
  region: SarifRegion;
}

export interface SarifLocation {
  physicalLocation: SarifPhysicalLocation;
}

export interface SarifResult {
  ruleId: string;
  ruleIndex: number;
  level: SarifLevel;
  message: SarifMessage;
  locations: SarifLocation[];
  properties: Record<string, unknown>;
}

export interface SarifDriver {
  name: string;
  version: string;
  informationUri: string;
  rules: SarifReportingDescriptor[];
}

export interface SarifRun {
  tool: { driver: SarifDriver };
  results: SarifResult[];
}

export interface SarifLog {
  version: "2.1.0";
  $schema: string;
  runs: SarifRun[];
}

export const SARIF_VERSION = "2.1.0";
export const SARIF_SCHEMA = "https://json.schemastore.org/sarif-2.1.0.json";
export const SARIF_TOOL_NAME = "AgentGuard X";
export const SARIF_TOOL_VERSION = "0.1.0";
export const SARIF_TOOL_INFORMATION_URI = "https://github.com/agentguard-x/agentguard";

const MAX_MESSAGE_CHARS = 1000;

const SEVERITY_RANK: Record<Severity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
};

/** Map an AgentGuard severity onto the SARIF result level. */
export function severityToLevel(severity: Severity): SarifLevel {
  switch (severity) {
    case "critical":
    case "high":
      return "error";
    case "medium":
      return "warning";
    case "low":
    case "info":
      return "note";
  }
}

export interface ToSarifInput {
  findings: Finding[];
  agentId: string;
  agentName: string;
  sourceRef: string;
  missionId: string;
}

/**
 * Encode findings as a valid SARIF 2.1.0 log. Rules are one per distinct
 * `category` (sorted), results are sorted critical-first then by title, and an
 * empty findings list still yields a structurally valid log with zero results.
 */
export function toSarif(input: ToSarifInput): SarifLog {
  const categories = [...new Set(input.findings.map((f) => f.category))].sort();

  const rules: SarifReportingDescriptor[] = categories.map((category) => ({
    id: category,
    name: category,
    shortDescription: { text: `AgentGuard X finding category: ${category}` },
  }));

  const ruleIndex = new Map<string, number>(categories.map((category, index): [string, number] => [category, index]));

  const sourceRef = input.sourceRef && input.sourceRef.trim() !== "" ? input.sourceRef : `agentguard://${input.agentId}`;

  const results: SarifResult[] = [...input.findings]
    .sort((a, b) => {
      const bySeverity = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
      if (bySeverity !== 0) return bySeverity;
      return a.title < b.title ? -1 : a.title > b.title ? 1 : 0;
    })
    .map((finding) => {
      const properties: Record<string, unknown> = {
        agentId: input.agentId,
        missionId: input.missionId,
        severity: finding.severity,
        toolName: finding.toolName,
      };
      if (finding.citation && finding.citation.quote) {
        properties.citationQuote = finding.citation.quote;
      }
      return {
        ruleId: finding.category,
        ruleIndex: ruleIndex.get(finding.category) ?? 0,
        level: severityToLevel(finding.severity),
        message: { text: `${finding.title} — ${finding.description}`.slice(0, MAX_MESSAGE_CHARS) },
        locations: [
          {
            physicalLocation: {
              artifactLocation: { uri: sourceRef },
              region: { startLine: 1 },
            },
          },
        ],
        properties,
      };
    });

  return {
    version: SARIF_VERSION,
    $schema: SARIF_SCHEMA,
    runs: [
      {
        tool: {
          driver: {
            name: SARIF_TOOL_NAME,
            version: SARIF_TOOL_VERSION,
            informationUri: SARIF_TOOL_INFORMATION_URI,
            rules,
          },
        },
        results,
      },
    ],
  };
}
