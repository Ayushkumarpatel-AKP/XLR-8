import {
  type DataClass,
  type EdgeKind,
  type SideEffect,
  type ToolDefinition,
  type ToolTarget,
  newId,
} from "@agentguard/contracts";

/** Raw tool entry as returned by an MCP `tools/list` call. */
export interface McpToolListing {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
  /** Optional vendor annotations carrying real metadata (not name-guessed). */
  annotations?: {
    sideEffect?: SideEffect;
    edge?: EdgeKind;
    dataClasses?: DataClass[];
    targets?: ToolTarget[];
    external?: boolean;
    approvalRequired?: boolean;
    scopes?: Array<{ resource: string; action: string; dataClass: DataClass; approvalRequired?: boolean }>;
  };
}

export interface McpServerManifest {
  name: string;
  version?: string;
  tools: McpToolListing[];
}

/**
 * Ingest MCP tool listings into AgentGuard ToolDefinitions.
 *
 * Metadata is taken from schema and annotations. We never infer risk purely
 * from a tool's name — a tool with no evidence is marked `evidenceBacked:false`
 * and left with conservative (`none`) defaults.
 */
export function ingestMcpServer(manifest: McpServerManifest): ToolDefinition[] {
  return manifest.tools.map((t) => {
    const a = t.annotations ?? {};
    const hasEvidence = Boolean(t.inputSchema) || Boolean(t.description) || Boolean(t.annotations);
    return {
      id: newId("tool"),
      name: t.name,
      description: t.description ?? t.name,
      mcpServer: manifest.name,
      inputSchema: t.inputSchema ?? {},
      scopes: (a.scopes ?? []).map((s) => ({
        id: newId("tool"),
        resource: s.resource,
        action: s.action,
        dataClass: s.dataClass,
        approvalRequired: s.approvalRequired ?? false,
        granted: true,
      })),
      sideEffect: a.sideEffect ?? "none",
      dataClasses: a.dataClasses ?? [],
      edge: a.edge ?? "EXECUTE",
      targets: a.targets ?? [],
      external: a.external ?? false,
      approvalRequired: a.approvalRequired ?? false,
      evidenceBacked: hasEvidence,
    } satisfies ToolDefinition;
  });
}

/**
 * Minimal OpenAPI → ToolDefinition ingestion. Each operation becomes a tool;
 * side effects are derived from the HTTP method (GET=read, everything else=write).
 */
export function ingestOpenApi(name: string, spec: Record<string, unknown>): ToolDefinition[] {
  const paths = (spec.paths ?? {}) as Record<string, Record<string, unknown>>;
  const out: ToolDefinition[] = [];
  for (const [path, ops] of Object.entries(paths)) {
    for (const method of Object.keys(ops)) {
      if (!["get", "post", "put", "patch", "delete"].includes(method)) continue;
      const op = ops[method] as Record<string, unknown>;
      const sideEffect: SideEffect = method === "get" ? "read" : method === "delete" ? "irreversible" : "write";
      out.push({
        id: newId("tool"),
        name: `${name}.${method}.${path}`,
        description: typeof op.summary === "string" ? op.summary : "",
        inputSchema: (op.requestBody as Record<string, unknown>) ?? {},
        scopes: [],
        sideEffect,
        dataClasses: [],
        edge: method === "get" ? "READ" : "WRITE",
        targets: [],
        external: true,
        approvalRequired: false,
        evidenceBacked: true,
      });
    }
  }
  return out;
}
