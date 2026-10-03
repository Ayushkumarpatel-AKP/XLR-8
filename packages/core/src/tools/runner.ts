import type { AgentRuntimeConfig, ToolDefinition } from "@agentguard/contracts";

export interface ToolRunResult {
  ok: boolean;
  data: unknown;
}

export interface ToolRunner {
  run(tool: ToolDefinition, args: Record<string, unknown>): Promise<ToolRunResult>;
}

/** The response body kept for a live call, before it becomes unbounded noise. */
const MAX_BODY_CHARS = 4000;

function hostOf(serverUrl: string): string {
  try {
    return new URL(serverUrl).host;
  } catch {
    return "";
  }
}

/** Substitute `{name}` path params from `args`; hand back what was left over. */
function buildRequest(
  http: NonNullable<ToolDefinition["http"]>,
  args: Record<string, unknown>,
): { url: string; body: Record<string, unknown> } {
  const remaining: Record<string, unknown> = { ...args };
  const path = http.path.replace(/\{([^}]+)\}/g, (_match, name: string) => {
    const value = remaining[name];
    delete remaining[name];
    return encodeURIComponent(value === undefined || value === null ? "" : String(value));
  });
  const base = http.serverUrl.replace(/\/+$/, "");
  return { url: `${base}${path.startsWith("/") ? path : `/${path}`}`, body: remaining };
}

/**
 * Decide — and, only when every gate passes, send — one tool call.
 *
 * The refusal order is deliberate and every refusal is returned as data with a
 * machine-readable `blocked` flag and a human reason, never thrown and never
 * swallowed into a fake success. A capability that was never declared, a
 * disabled switch, an out-of-scope host and an unpermitted verb are all
 * refusals; only a network failure is an error, and it says so.
 */
export function createToolRunner(
  cfg: AgentRuntimeConfig,
  opts: { fetchImpl?: typeof fetch; env?: NodeJS.ProcessEnv } = {},
): ToolRunner {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const env = opts.env ?? process.env;

  return {
    async run(tool, args) {
      const http = tool.http;
      if (!http) {
        return { ok: false, data: { blocked: true, reason: "no declared HTTP shape for this tool" } };
      }
      if (!cfg.toolExecution.enabled) {
        return { ok: false, data: { blocked: true, reason: "live tool execution is disabled" } };
      }

      const host = hostOf(http.serverUrl);
      const allowedHosts = cfg.toolExecution.allowedHosts.map((h) => h.toLowerCase());
      if (!allowedHosts.includes(host.toLowerCase())) {
        return { ok: false, data: { blocked: true, reason: "host not in scope", host } };
      }

      const method = http.method.toUpperCase();
      const allowedMethods = cfg.toolExecution.allowedMethods.map((m) => m.toUpperCase());
      if (!allowedMethods.includes(method)) {
        return { ok: false, data: { blocked: true, reason: "method not permitted", method } };
      }

      const { url, body } = buildRequest(http, args);

      if (cfg.toolExecution.mode === "dry-run") {
        return { ok: true, data: { dryRun: true, method, url, bodySent: false } };
      }

      const headers: Record<string, string> = { ...cfg.headers };
      const apiKey = cfg.apiKeyEnv ? env[cfg.apiKeyEnv] : undefined;
      if (apiKey) headers["authorization"] = `Bearer ${apiKey}`;
      const hasBody = method !== "GET" && method !== "HEAD";
      if (hasBody && !headers["content-type"]) headers["content-type"] = "application/json";

      try {
        const res = await fetchImpl(url, {
          method,
          headers,
          ...(hasBody ? { body: JSON.stringify(body) } : {}),
          signal: AbortSignal.timeout(cfg.timeoutMs),
        });
        const text = await res.text();
        return { ok: true, data: { status: res.status, body: text.slice(0, MAX_BODY_CHARS) } };
      } catch (err) {
        return { ok: false, data: { blocked: false, error: (err as Error).message } };
      }
    },
  };
}
