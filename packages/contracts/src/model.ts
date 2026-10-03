import { z } from "zod";

/** Every capability edge in the trust/capability graph. */
export const EdgeKindSchema = z.enum([
  "READ",
  "WRITE",
  "EXECUTE",
  "SEND",
  "NETWORK",
  "FINANCIAL",
  "DEVICE_CONTROL",
  "TRUST",
]);
export type EdgeKind = z.infer<typeof EdgeKindSchema>;

/** Classification of the data a capability touches. */
export const DataClassSchema = z.enum([
  "public",
  "internal",
  "confidential",
  "pii",
  "financial",
  "secret",
]);
export type DataClass = z.infer<typeof DataClassSchema>;

/** Whether invoking a capability changes the world. */
export const SideEffectSchema = z.enum(["none", "read", "write", "irreversible"]);
export type SideEffect = z.infer<typeof SideEffectSchema>;

/** Node kinds in the capability/trust graph. */
export const NodeKindSchema = z.enum([
  "agent",
  "tool",
  "mcp_server",
  "data_store",
  "api",
  "payment",
  "email",
  "crm",
  "iot",
  "external_service",
]);
export type NodeKind = z.infer<typeof NodeKindSchema>;

/** A permission scope granted to an agent. */
export const PermissionScopeSchema = z.object({
  id: z.string(),
  resource: z.string(),
  action: z.string(),
  dataClass: DataClassSchema,
  approvalRequired: z.boolean().default(false),
  granted: z.boolean().default(true),
});
export type PermissionScope = z.infer<typeof PermissionScopeSchema>;

/** Something a tool can reach (a data store, API, payment rail, etc.). */
export const ToolTargetSchema = z.object({
  id: z.string(),
  kind: NodeKindSchema,
  label: z.string(),
  edge: EdgeKindSchema,
});
export type ToolTarget = z.infer<typeof ToolTargetSchema>;

/** A single capability/tool the agent can invoke. */
export const ToolDefinitionSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  mcpServer: z.string().optional(),
  inputSchema: z.record(z.unknown()).default({}),
  scopes: z.array(PermissionScopeSchema).default([]),
  sideEffect: SideEffectSchema.default("none"),
  dataClasses: z.array(DataClassSchema).default([]),
  edge: EdgeKindSchema.default("EXECUTE"),
  targets: z.array(ToolTargetSchema).default([]),
  external: z.boolean().default(false),
  approvalRequired: z.boolean().default(false),
  /** True when discovered from schema/source evidence rather than guessed from name. */
  evidenceBacked: z.boolean().default(false),
});
export type ToolDefinition = z.infer<typeof ToolDefinitionSchema>;

/** Provenance for an imported agent (where it came from, what enriched it). */
export const AgentAnnotationsSchema = z.object({
  importedFrom: z.string().optional(),
  importedAt: z.string().optional(),
  /** Provider id / model that inferred the tool semantics, when used. */
  classifiedBy: z.string().optional(),
  classifiedAt: z.string().optional(),
});
export type AgentAnnotations = z.infer<typeof AgentAnnotationsSchema>;

/** A declared agent manifest (JSON/YAML/MCP-derived). */
export const AgentManifestSchema = z.object({
  id: z.string(),
  name: z.string(),
  purpose: z.string().default(""),
  model: z.string().default("unknown"),
  version: z.string().default("0.0.0"),
  description: z.string().default(""),
  owner: z.string().default("unknown"),
  environment: z.enum(["sandbox", "local", "staging", "production"]).default("sandbox"),
  tools: z.array(ToolDefinitionSchema).default([]),
  scopes: z.array(PermissionScopeSchema).default([]),
  mcpServers: z.array(z.string()).default([]),
  externalConnectivity: z.boolean().default(false),
  sourceRef: z.string().default("inline"),
  annotations: AgentAnnotationsSchema.optional(),
});
export type AgentManifest = z.infer<typeof AgentManifestSchema>;

/** An immutable snapshot of an agent's posture, used for drift comparison. */
export const AgentSnapshotSchema = z.object({
  id: z.string(),
  agentId: z.string(),
  label: z.string(),
  capturedAt: z.string(),
  toolNames: z.array(z.string()),
  scopes: z.array(PermissionScopeSchema),
  externalDestinations: z.array(z.string()),
  contentDigest: z.string(),
});
export type AgentSnapshot = z.infer<typeof AgentSnapshotSchema>;

/** Graph node. */
export const GraphNodeSchema = z.object({
  id: z.string(),
  kind: NodeKindSchema,
  label: z.string(),
  riskLevel: z.enum(["none", "low", "medium", "high", "critical"]).default("none"),
  metadata: z.record(z.unknown()).default({}),
});
export type GraphNode = z.infer<typeof GraphNodeSchema>;

/** Graph edge. */
export const GraphEdgeSchema = z.object({
  id: z.string(),
  from: z.string(),
  to: z.string(),
  kind: EdgeKindSchema,
  label: z.string().default(""),
  evidenceIds: z.array(z.string()).default([]),
});
export type GraphEdge = z.infer<typeof GraphEdgeSchema>;

export const CapabilityGraphSchema = z.object({
  agentId: z.string(),
  nodes: z.array(GraphNodeSchema),
  edges: z.array(GraphEdgeSchema),
  builtAt: z.string(),
});
export type CapabilityGraph = z.infer<typeof CapabilityGraphSchema>;
