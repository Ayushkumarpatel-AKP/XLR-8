import {
  type AgentManifest,
  type DataClass,
  type EdgeKind,
  type SideEffect,
  type ToolTarget,
  newId,
} from "@agentguard/contracts";
import { ingestMcpServer, type McpServerManifest } from "@agentguard/mcp";

const TARGETS = {
  customerDb: { id: "customer_db", kind: "data_store", label: "Customer Database", edge: "READ" } as ToolTarget,
  paymentApi: { id: "payment_api", kind: "payment", label: "Payment API", edge: "FINANCIAL" } as ToolTarget,
  emailService: { id: "email_service", kind: "email", label: "Email Service", edge: "SEND" } as ToolTarget,
  crmSystem: { id: "crm_system", kind: "crm", label: "CRM System", edge: "WRITE" } as ToolTarget,
  ticketSystem: { id: "ticket_system", kind: "api", label: "Ticket System", edge: "WRITE" } as ToolTarget,
  externalApi: { id: "external_api", kind: "external_service", label: "External API", edge: "NETWORK" } as ToolTarget,
};

interface ToolSpec {
  name: string;
  description: string;
  edge: EdgeKind;
  sideEffect: SideEffect;
  dataClasses: DataClass[];
  targets: ToolTarget[];
  external?: boolean;
  approvalRequired?: boolean;
  scope?: { resource: string; action: string; dataClass: DataClass; approvalRequired?: boolean };
  inputSchema: Record<string, unknown>;
}

function baseTools(): ToolSpec[] {
  return [
    {
      name: "get_transactions",
      description: "List recent transactions for a customer.",
      edge: "READ",
      sideEffect: "read",
      dataClasses: ["financial"],
      targets: [TARGETS.customerDb],
      scope: { resource: "customer_db", action: "read", dataClass: "financial" },
      inputSchema: { type: "object", properties: { customer_id: { type: "string" } }, required: ["customer_id"] },
    },
    {
      name: "get_customer_profile",
      description: "Read a customer profile including contact and KYC fields.",
      edge: "READ",
      sideEffect: "read",
      dataClasses: ["pii"],
      targets: [TARGETS.customerDb],
      scope: { resource: "customer_db", action: "read_profile", dataClass: "pii" },
      inputSchema: { type: "object", properties: { customer_id: { type: "string" } }, required: ["customer_id"] },
    },
    {
      name: "refund_payment",
      description: "Issue a refund against a settled transaction.",
      edge: "FINANCIAL",
      sideEffect: "write",
      dataClasses: ["financial"],
      targets: [TARGETS.paymentApi],
      approvalRequired: true,
      scope: {
        resource: "payment_api",
        action: "refund",
        dataClass: "financial",
        approvalRequired: true,
      },
      inputSchema: {
        type: "object",
        properties: {
          amount: { type: "number" },
          merchant: { type: "string" },
          reason: { type: "string" },
          approval_ref: { type: "string" },
        },
        required: ["amount", "merchant"],
      },
    },
    {
      name: "send_email",
      description: "Send an email to a customer or partner address.",
      edge: "SEND",
      sideEffect: "write",
      dataClasses: ["internal"],
      targets: [TARGETS.emailService],
      external: true,
      scope: { resource: "email_service", action: "send", dataClass: "internal" },
      inputSchema: {
        type: "object",
        properties: { to: { type: "string" }, subject: { type: "string" }, body: { type: "string" } },
        required: ["to", "subject"],
      },
    },
    {
      name: "update_crm",
      description: "Attach a note to a customer record in the CRM.",
      edge: "WRITE",
      sideEffect: "write",
      dataClasses: ["internal"],
      targets: [TARGETS.crmSystem],
      scope: { resource: "crm_system", action: "update", dataClass: "internal" },
      inputSchema: {
        type: "object",
        properties: { customer_id: { type: "string" }, note: { type: "string" } },
        required: ["customer_id", "note"],
      },
    },
    {
      name: "create_ticket",
      description: "Open a support ticket for a customer.",
      edge: "WRITE",
      sideEffect: "write",
      dataClasses: ["internal"],
      targets: [TARGETS.ticketSystem],
      scope: { resource: "ticket_system", action: "create", dataClass: "internal" },
      inputSchema: {
        type: "object",
        properties: { customer_id: { type: "string" }, subject: { type: "string" } },
        required: ["customer_id", "subject"],
      },
    },
    {
      name: "call_external_api",
      description: "Call a third-party HTTP endpoint.",
      edge: "NETWORK",
      sideEffect: "write",
      dataClasses: [],
      targets: [TARGETS.externalApi],
      external: true,
      scope: { resource: "external_api", action: "post", dataClass: "public" },
      inputSchema: {
        type: "object",
        properties: { destination: { type: "string" }, payload: { type: "object" } },
        required: ["destination"],
      },
    },
  ];
}

/** Tools added only in the drifted v2 manifest (permission-drift scenario). */
function driftTools(): ToolSpec[] {
  return [
    {
      name: "export_customer_data",
      description: "Bulk export customer records to an external marketing partner.",
      edge: "WRITE",
      sideEffect: "write",
      dataClasses: ["confidential"],
      targets: [TARGETS.customerDb, TARGETS.externalApi],
      external: true,
      scope: { resource: "customer_db", action: "export", dataClass: "pii" },
      inputSchema: {
        type: "object",
        properties: { segment: { type: "string" }, destination: { type: "string" } },
        required: ["destination"],
      },
    },
    {
      name: "marketing_sync",
      description: "Sync customer segments to an external marketing platform.",
      edge: "NETWORK",
      sideEffect: "write",
      dataClasses: ["confidential"],
      targets: [TARGETS.externalApi],
      external: true,
      scope: { resource: "external_api", action: "sync", dataClass: "pii" },
      inputSchema: {
        type: "object",
        properties: { segment: { type: "string" } },
        required: ["segment"],
      },
    },
  ];
}

function specToMcp(spec: ToolSpec, opts: { dropApproval?: boolean }): McpServerManifest["tools"][number] {
  const approvalRequired = opts.dropApproval ? false : spec.approvalRequired ?? false;
  return {
    name: spec.name,
    description: spec.description,
    inputSchema: spec.inputSchema,
    annotations: {
      sideEffect: spec.sideEffect,
      edge: spec.edge,
      dataClasses: spec.dataClasses,
      targets: spec.targets,
      external: spec.external ?? false,
      approvalRequired,
      scopes: spec.scope
        ? [
            {
              resource: spec.scope.resource,
              action: spec.scope.action,
              dataClass: spec.scope.dataClass,
              approvalRequired: opts.dropApproval ? false : (spec.scope.approvalRequired ?? approvalRequired),
            },
          ]
        : [],
    },
  };
}

/**
 * The AcmeBank agent as exposed over a mock MCP server.
 * v2 models a drift event: refund approval removed and two powerful, external,
 * PII-touching tools added.
 */
export function acmeBankMcpServer(version: "v1" | "v2" = "v1"): McpServerManifest {
  const tools = baseTools().map((t) => specToMcp(t, { dropApproval: version === "v2" }));
  if (version === "v2") tools.push(...driftTools().map((t) => specToMcp(t, {})));
  return { name: "acmebank-tools", version: version === "v2" ? "2.0.0" : "1.0.0", tools };
}

/** Build a full AgentManifest for the AcmeBank support agent. */
export function buildAcmeBankManifest(version: "v1" | "v2" = "v1"): AgentManifest {
  const server = acmeBankMcpServer(version);
  const tools = ingestMcpServer(server);
  const scopes = tools
    .flatMap((t) => t.scopes)
    .filter((s, i, arr) => arr.findIndex((x) => `${x.resource}:${x.action}` === `${s.resource}:${s.action}`) === i);

  return {
    id: "acmebank-assistant",
    name: "AcmeBank AI Assistant",
    purpose: "Customer support agent for a retail bank.",
    model: "claude-3.5",
    version: version === "v2" ? "2.0.0" : "1.0.0",
    description:
      "Handles customer support requests: account questions, refunds, and escalations. Touches customer, payment, email, CRM and ticket systems.",
    owner: "AcmeBank Digital",
    environment: "sandbox",
    tools,
    scopes,
    mcpServers: [server.name],
    externalConnectivity: tools.some((t) => t.external),
    sourceRef: `demo-lab://acmebank/${version}`,
  };
}

export function demoAgentId(): string {
  return "acmebank-assistant";
}

export { newId };
