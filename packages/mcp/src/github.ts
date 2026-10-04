import {
  type AgentManifest,
  type EdgeKind,
  type SideEffect,
  type ToolDefinition,
  type ToolTarget,
  newId,
} from "@agentguard/contracts";
import { parse as parseYaml } from "yaml";

/* ------------------------------------------------------------------ *
 * Ingest a real agent's capability surface from GitHub.
 *
 * Nothing is executed: we fetch the machine-readable description a repository
 * already publishes (an OpenAPI/Swagger spec, or an agent manifest with a
 * `tools` array) and turn it into real tool definitions AgentGuard can audit.
 * ------------------------------------------------------------------ */

export interface GitHubRef {
  /** "owner/name" */
  repo: string;
  /** File to read. Omit to probe a list of conventional paths. */
  path?: string;
  /** Branch/tag/sha. Omit to use the repository default branch. */
  ref?: string;
}

export interface IngestedAgent {
  kind: "openapi" | "manifest";
  name: string;
  description: string;
  tools: ToolDefinition[];
  sourceRef: string;
  /** Human-readable notes about what happened (limits, choices, fallbacks). */
  notes: string[];
  /**
   * The owner's GitHub avatar, when the repository has one. It is the closest
   * thing a repository has to a logo, and it makes an imported agent
   * recognisable in the UI.
   */
  avatarUrl?: string;
}

export interface IngestOptions {
  maxTools?: number;
  token?: string;
  /** Override the base host for raw/API calls (for tests). */
  rawBase?: string;
  apiBase?: string;
}

const DEFAULT_PATHS = [
  "openapi.json",
  "openapi.yaml",
  "openapi.yml",
  "swagger.json",
  "swagger.yaml",
  "swagger.yml",
  "api/openapi.json",
  "api/openapi.yaml",
  "docs/openapi.yaml",
  "docs/openapi.json",
  "public/openapi.json",
  "agent.json",
  "agent.yaml",
  "manifest.json",
  "tools.json",
];

async function get(url: string, token: string | undefined, maxBytes: number): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: {
        "user-agent": "agentguard-x",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return null;
    const len = Number(res.headers.get("content-length") ?? 0);
    if (len && len > maxBytes) return null;
    const text = await res.text();
    return text.length > maxBytes ? text.slice(0, maxBytes) : text;
  } catch {
    return null;
  }
}

function parseDoc(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    /* fall through to YAML */
  }
  try {
    return parseYaml(text) as unknown;
  } catch {
    return null;
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isOpenApi(doc: unknown): doc is Record<string, unknown> {
  return isRecord(doc) && ("openapi" in doc || "swagger" in doc) && isRecord(doc.paths);
}

function manifestTools(doc: unknown): Record<string, unknown>[] | null {
  if (!isRecord(doc)) return null;
  const tools = doc.tools;
  if (!Array.isArray(tools)) return null;
  return tools.filter(isRecord);
}

function hostOf(doc: Record<string, unknown>): string {
  const servers = doc.servers;
  if (Array.isArray(servers) && isRecord(servers[0]) && typeof servers[0].url === "string") {
    try {
      return new URL(servers[0].url as string).host;
    } catch {
      return String(servers[0].url);
    }
  }
  if (typeof doc.host === "string") return doc.host;
  return "api";
}

function toolFromManifestEntry(entry: Record<string, unknown>, hostTarget: ToolTarget | null): ToolDefinition {
  const targets: ToolTarget[] = Array.isArray(entry.targets)
    ? (entry.targets as ToolTarget[])
    : hostTarget
      ? [hostTarget]
      : [];
  return {
    id: newId("tool"),
    name: typeof entry.name === "string" ? entry.name : "unnamed_tool",
    description: typeof entry.description === "string" ? entry.description : "",
    inputSchema: isRecord(entry.inputSchema) ? entry.inputSchema : isRecord(entry.parameters) ? entry.parameters : {},
    scopes: [],
    sideEffect: (entry.sideEffect as SideEffect) ?? "write",
    dataClasses: Array.isArray(entry.dataClasses) ? (entry.dataClasses as ToolDefinition["dataClasses"]) : [],
    edge: (entry.edge as EdgeKind) ?? "EXECUTE",
    targets,
    external: entry.external === true,
    approvalRequired: entry.approvalRequired === true,
    evidenceBacked: true,
  };
}

interface RepoMeta {
  defaultBranch: string;
  avatarUrl?: string;
}

/**
 * Only GitHub's own avatar hosts.
 *
 * The URL comes from an API response, and it is later rendered by a browser, so
 * it is worth narrowing: anything else is dropped rather than turned into an
 * image request the user never asked for.
 */
function safeAvatarUrl(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  try {
    const url = new URL(value);
    const ok = ["avatars.githubusercontent.com", "github.com", "raw.githubusercontent.com"];
    return url.protocol === "https:" && ok.includes(url.hostname) ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

/** The repository's own metadata: its default branch and its owner's picture. */
async function repoMeta(repo: string, apiBase: string, token?: string): Promise<RepoMeta> {
  const text = await get(`${apiBase}/repos/${repo}`, token, 200_000);
  if (!text) return { defaultBranch: "main" };
  try {
    const meta = JSON.parse(text) as { default_branch?: string; owner?: { avatar_url?: unknown } };
    const avatarUrl = safeAvatarUrl(meta.owner?.avatar_url);
    return { defaultBranch: meta.default_branch ?? "main", ...(avatarUrl ? { avatarUrl } : {}) };
  } catch {
    return { defaultBranch: "main" };
  }
}

/**
 * Fetch and normalise an agent's tool surface from a GitHub repository.
 * Throws with a clear message when nothing usable is found.
 */
export async function ingestFromGitHub(input: GitHubRef, opts: IngestOptions = {}): Promise<IngestedAgent> {
  const maxTools = opts.maxTools ?? 60;
  const apiBase = opts.apiBase ?? "https://api.github.com";
  const rawBase = opts.rawBase ?? "https://raw.githubusercontent.com";
  const notes: string[] = [];

  if (!/^[\w.-]+\/[\w.-]+$/.test(input.repo)) {
    throw new Error(`repo must look like "owner/name" (got "${input.repo}")`);
  }

  // Fetched even when a ref is given: the same response carries the owner's
  // avatar, which is the only "logo" a repository has.
  const meta = await repoMeta(input.repo, apiBase, opts.token);
  const ref = input.ref ?? meta.defaultBranch;
  const candidates = input.path ? [input.path] : DEFAULT_PATHS;

  for (const path of candidates) {
    const url = `${rawBase}/${input.repo}/${ref}/${path}`;
    const text = await get(url, opts.token, 6_000_000);
    if (!text) continue;

    const doc = parseDoc(text);
    if (doc === null) {
      notes.push(`${path}: could not parse as JSON or YAML`);
      continue;
    }

    const sourceRef = `github:${input.repo}@${ref}/${path}`;

    if (isOpenApi(doc)) {
      const { ingestOpenApi } = await import("./ingest.js");
      const serverHost = hostOf(doc);
      const label = isRecord(doc.info) && typeof doc.info.title === "string" ? (doc.info.title as string) : input.repo;
      const target: ToolTarget = { id: `host:${serverHost}`, kind: "api", label: serverHost, edge: "NETWORK" };
      let tools = ingestOpenApi(slug(label), doc).map((t) => ({
        ...t,
        external: true,
        targets: [target],
      }));
      if (tools.length > maxTools) {
        notes.push(`spec declares ${tools.length} operations; keeping the first ${maxTools}`);
        tools = tools.slice(0, maxTools);
      }
      notes.push(`OpenAPI ${(doc.openapi as string) ?? (doc.swagger as string) ?? "?"} · server ${serverHost}`);
      return {
        kind: "openapi",
        name: label,
        description: isRecord(doc.info) && typeof doc.info.description === "string" ? (doc.info.description as string) : `${input.repo} API surface`,
        tools,
        sourceRef,
        notes,
        ...(meta.avatarUrl ? { avatarUrl: meta.avatarUrl } : {}),
      };
    }

    const entries = manifestTools(doc);
    if (entries) {
      const m = doc as Record<string, unknown>;
      const host = typeof m.host === "string" ? m.host : null;
      const target: ToolTarget | null = host ? { id: `host:${host}`, kind: "api", label: host, edge: "NETWORK" } : null;
      let tools = entries.map((e) => toolFromManifestEntry(e, target));
      if (tools.length > maxTools) {
        notes.push(`manifest declares ${tools.length} tools; keeping the first ${maxTools}`);
        tools = tools.slice(0, maxTools);
      }
      notes.push("agent manifest with a tools array");
      return {
        kind: "manifest",
        name: typeof m.name === "string" ? m.name : input.repo,
        description: typeof m.description === "string" ? m.description : `agent manifest from ${input.repo}`,
        tools,
        sourceRef,
        notes,
        ...(meta.avatarUrl ? { avatarUrl: meta.avatarUrl } : {}),
      };
    }

    notes.push(`${path}: parsed, but it is neither an OpenAPI spec nor an agent manifest`);
  }

  throw new Error(
    `No agent surface found in ${input.repo}@${ref}. Tried: ${candidates.join(", ")}. ` +
      `Pass --path <file> to point at a specific OpenAPI/Swagger spec or agent manifest.`,
  );
}

function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 32) || "api";
}

/** Build a registerable AgentManifest from an ingestion result. */
export function ingestedToManifest(result: IngestedAgent, overrides: Partial<AgentManifest> = {}): AgentManifest {
  const scopes = overrides.scopes ?? [
    {
      id: "scope_imported_api",
      resource: result.tools.find((t) => t.targets[0])?.targets[0]?.id ?? "api",
      action: "invoke",
      dataClass: "internal" as const,
      approvalRequired: false,
      granted: true,
    },
  ];
  // Provenance travels with the agent: the source's avatar rides along with
  // `importedFrom` and the rest, and anything the caller passed wins.
  const mergedAnnotations: Record<string, string> = {
    ...(result.avatarUrl ? { avatarUrl: result.avatarUrl } : {}),
    ...overrides.annotations,
  };
  const annotations = Object.keys(mergedAnnotations).length > 0 ? { annotations: mergedAnnotations } : {};

  return {
    id: overrides.id ?? slug(result.name),
    name: overrides.name ?? result.name,
    purpose: overrides.purpose ?? "Imported from GitHub for a static security audit.",
    model: overrides.model ?? "external",
    version: overrides.version ?? "1.0.0",
    description: overrides.description ?? result.description,
    owner: overrides.owner ?? "imported",
    environment: overrides.environment ?? "sandbox",
    tools: overrides.tools ?? result.tools,
    scopes,
    mcpServers: overrides.mcpServers ?? [],
    externalConnectivity: overrides.externalConnectivity ?? true,
    sourceRef: overrides.sourceRef ?? result.sourceRef,
    ...annotations,
  };
}
