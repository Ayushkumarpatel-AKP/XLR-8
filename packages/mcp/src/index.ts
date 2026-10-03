import {
  type DataClass,
  type EdgeKind,
  type SideEffect,
  type ToolDefinition,
  type ToolTarget,
  newId,
} from "@agentguard/contracts";

export * from "./stdio.js";
export * from "./ingest.js";
export * from "./github.js";

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
