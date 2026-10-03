import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ingestedToManifest, ingestFromGitHub } from "./github.js";

const OPENAPI = {
  openapi: "3.0.0",
  info: { title: "Test Bank API", description: "A tiny bank" },
  servers: [{ url: "https://api.testbank.example/v1" }],
  paths: {
    "/accounts": {
      get: { summary: "List accounts" },
      post: { summary: "Open an account" },
    },
    "/payments": {
      post: { summary: "Send a payment" },
      delete: { summary: "Cancel a payment" },
    },
  },
};

const MANIFEST = {
  name: "Ops Agent",
  description: "internal automation",
  host: "ops.internal",
  tools: [
    { name: "restart_service", description: "Restart a service", edge: "EXECUTE", sideEffect: "write" },
    { name: "read_logs", description: "Read logs", edge: "READ", sideEffect: "read", dataClasses: ["internal"] },
  ],
};

let server: Server;
let base = "";

beforeAll(async () => {
  server = createServer((req, res) => {
    const url = req.url ?? "";
    res.setHeader("content-type", "application/json");
    if (url.endsWith("/openapi.json")) {
      res.end(JSON.stringify(OPENAPI));
      return;
    }
    if (url.endsWith("/agent.json")) {
      res.end(JSON.stringify(MANIFEST));
      return;
    }
    res.statusCode = 404;
    res.end(JSON.stringify({ error: "not found" }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  base = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("GitHub ingestion", () => {
  it("turns an OpenAPI spec into real tool definitions", async () => {
    const result = await ingestFromGitHub(
      { repo: "owner/repo", path: "openapi.json" },
      { rawBase: base, apiBase: base },
    );

    expect(result.kind).toBe("openapi");
    expect(result.name).toBe("Test Bank API");
    expect(result.sourceRef).toContain("github:owner/repo@main/openapi.json");

    const names = result.tools.map((t) => t.name).sort();
    expect(names).toContain("test-bank-api.get./accounts");
    expect(names).toContain("test-bank-api.post./payments");

    // side effects come from the HTTP method, and every tool is externally reachable
    const del = result.tools.find((t) => t.name.endsWith("delete./payments"));
    expect(del?.sideEffect).toBe("irreversible");
    expect(del?.external).toBe(true);
    // the graph gets a real target node for the spec's server host
    expect(result.tools[0]?.targets[0]?.label).toBe("api.testbank.example");
  });

  it("turns an agent manifest into tool definitions", async () => {
    const result = await ingestFromGitHub(
      { repo: "owner/repo", path: "agent.json" },
      { rawBase: base, apiBase: base },
    );

    expect(result.kind).toBe("manifest");
    expect(result.name).toBe("Ops Agent");
    expect(result.tools).toHaveLength(2);
    expect(result.tools[0]?.targets[0]?.label).toBe("ops.internal");
    expect(result.tools[1]?.dataClasses).toEqual(["internal"]);
  });

  it("caps the number of imported tools", async () => {
    const result = await ingestFromGitHub(
      { repo: "owner/repo", path: "openapi.json" },
      { rawBase: base, apiBase: base, maxTools: 2 },
    );
    expect(result.tools).toHaveLength(2);
    expect(result.notes.join(" ")).toContain("keeping the first 2");
  });

  it("explains itself when nothing usable is found", async () => {
    await expect(
      ingestFromGitHub({ repo: "owner/repo", path: "missing.yaml" }, { rawBase: base, apiBase: base }),
    ).rejects.toThrow(/No agent surface found/);
  });

  it("rejects malformed repo names", async () => {
    await expect(ingestFromGitHub({ repo: "not-a-repo" }, { rawBase: base, apiBase: base })).rejects.toThrow(
      /owner\/name/,
    );
  });

  it("carries provenance into the manifest", async () => {
    const result = await ingestFromGitHub(
      { repo: "owner/repo", path: "openapi.json" },
      { rawBase: base, apiBase: base },
    );
    const manifest = ingestedToManifest(result, {
      annotations: { importedFrom: result.sourceRef, classifiedBy: "groq (4 tools)" },
    });
    expect(manifest.annotations?.importedFrom).toContain("github:owner/repo");
    expect(manifest.annotations?.classifiedBy).toBe("groq (4 tools)");
    expect(manifest.sourceRef).toBe(result.sourceRef);
    expect(manifest.tools).toHaveLength(result.tools.length);
  });
});
