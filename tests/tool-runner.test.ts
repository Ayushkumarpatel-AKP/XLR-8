import { describe, expect, it, vi } from "vitest";
import { AgentRuntimeConfigSchema, ToolDefinitionSchema } from "@agentguard/contracts";
import { createToolRunner } from "@agentguard/core";

function runtimeConfig(overrides: Record<string, unknown> = {}) {
  return AgentRuntimeConfigSchema.parse({
    kind: "openai-compatible",
    baseUrl: "https://api.example.test",
    toolExecution: {
      enabled: true,
      allowedHosts: ["api.example.test"],
      allowedMethods: ["GET", "HEAD", "POST"],
      mode: "live",
      ...overrides,
    },
  });
}

const getTool = ToolDefinitionSchema.parse({
  id: "tool.get",
  name: "get_customer",
  description: "Read a customer",
  http: { method: "GET", path: "/customers/{customerId}", serverUrl: "https://api.example.test" },
});

const postTool = ToolDefinitionSchema.parse({
  id: "tool.post",
  name: "create_order",
  description: "Create an order",
  http: { method: "POST", path: "/customers/{customerId}/orders", serverUrl: "https://api.example.test" },
});

const deleteTool = ToolDefinitionSchema.parse({
  id: "tool.del",
  name: "delete_customer",
  description: "Delete a customer",
  http: { method: "DELETE", path: "/customers/{customerId}", serverUrl: "https://api.example.test" },
});

const noHttpTool = ToolDefinitionSchema.parse({ id: "tool.plain", name: "plain", description: "No HTTP shape" });

describe("tool runner — refusal gates and live execution", () => {
  it("refuses a tool with no declared HTTP shape", async () => {
    const runner = createToolRunner(runtimeConfig());
    const result = await runner.run(noHttpTool, {});
    expect(result.ok).toBe(false);
    expect(result.data).toMatchObject({ blocked: true, reason: "no declared HTTP shape for this tool" });
  });

  it("refuses when live tool execution is disabled", async () => {
    const runner = createToolRunner(runtimeConfig({ enabled: false }));
    const result = await runner.run(getTool, { customerId: "C1" });
    expect(result.ok).toBe(false);
    expect(result.data).toMatchObject({ blocked: true, reason: "live tool execution is disabled" });
  });

  it("refuses a host that is not in scope", async () => {
    const runner = createToolRunner(runtimeConfig({ allowedHosts: ["other.example.test"] }));
    const result = await runner.run(getTool, { customerId: "C1" });
    expect(result.ok).toBe(false);
    expect(result.data).toMatchObject({ blocked: true, reason: "host not in scope", host: "api.example.test" });
  });

  it("refuses a method that is not permitted", async () => {
    const runner = createToolRunner(runtimeConfig({ allowedMethods: ["GET", "HEAD"] }));
    const result = await runner.run(deleteTool, { customerId: "C1" });
    expect(result.ok).toBe(false);
    expect(result.data).toMatchObject({ blocked: true, reason: "method not permitted", method: "DELETE" });
  });

  it("dry-run resolves the call and sends NOTHING", async () => {
    const fetchImpl = vi.fn();
    const runner = createToolRunner(runtimeConfig({ mode: "dry-run" }), { fetchImpl });
    const result = await runner.run(postTool, { customerId: "C1", note: "hello" });
    expect(result.ok).toBe(true);
    expect(result.data).toEqual({
      dryRun: true,
      method: "POST",
      url: "https://api.example.test/customers/C1/orders",
      bodySent: false,
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("live call sends the request and returns status + body", async () => {
    const fetchImpl = vi.fn(async () => new Response("pong", { status: 200 }));
    const runner = createToolRunner(runtimeConfig(), { fetchImpl });
    const result = await runner.run(postTool, { customerId: "C1", note: "hello" });

    expect(result.ok).toBe(true);
    expect(result.data).toEqual({ status: 200, body: "pong" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.example.test/customers/C1/orders");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ note: "hello" });
    expect((init.headers as Record<string, string>)["content-type"]).toBe("application/json");
  });

  it("does not send a body for GET", async () => {
    const fetchImpl = vi.fn(async () => new Response("ok", { status: 200 }));
    const runner = createToolRunner(runtimeConfig(), { fetchImpl });
    await runner.run(getTool, { customerId: "C1", ignored: true });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.example.test/customers/C1");
    expect(init.body).toBeUndefined();
  });

  it("truncates the response body to 4000 characters", async () => {
    const fetchImpl = vi.fn(async () => new Response("x".repeat(5000), { status: 200 }));
    const runner = createToolRunner(runtimeConfig(), { fetchImpl });
    const result = await runner.run(getTool, { customerId: "C1" });
    expect(result.ok).toBe(true);
    expect((result.data as { body: string }).body.length).toBe(4000);
  });

  it("adds a Bearer header only when the named env var is non-empty", async () => {
    const fetchImpl = vi.fn(async () => new Response("ok", { status: 200 }));
    const cfg = runtimeConfig();
    cfg.apiKeyEnv = "AG_TEST_TOKEN";

    const withKey = createToolRunner(cfg, { fetchImpl, env: { AG_TEST_TOKEN: "s3cret" } });
    await withKey.run(getTool, { customerId: "C1" });
    const [, first] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect((first.headers as Record<string, string>)["authorization"]).toBe("Bearer s3cret");

    fetchImpl.mockClear();
    const withoutKey = createToolRunner(cfg, { fetchImpl, env: { AG_TEST_TOKEN: "" } });
    await withoutKey.run(getTool, { customerId: "C1" });
    const [, second] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect((second.headers as Record<string, string>)["authorization"]).toBeUndefined();
  });

  it("compares methods case-insensitively", async () => {
    const fetchImpl = vi.fn(async () => new Response("ok", { status: 200 }));
    const runner = createToolRunner(runtimeConfig({ allowedMethods: ["post"] }), { fetchImpl });
    const result = await runner.run(postTool, { customerId: "C1" });
    expect(result.ok).toBe(true);
  });

  it("reports a network failure as an error, not a success", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    });
    const runner = createToolRunner(runtimeConfig(), { fetchImpl });
    const result = await runner.run(getTool, { customerId: "C1" });
    expect(result.ok).toBe(false);
    expect(result.data).toMatchObject({ blocked: false, error: "ECONNREFUSED" });
  });
});
