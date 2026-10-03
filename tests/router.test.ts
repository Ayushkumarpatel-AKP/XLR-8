import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ModelRouter } from "@agentguard/model-router";

/* ------------------------------------------------------------------ *
 * A transient provider failure must not poison every later run, and the
 * failure must say what actually went wrong.
 *
 * Reported: pressing "Run Security Mission" produced a War Room that filled up
 * and then stopped, with the run reporting "set GROQ_API_KEY" for a key that was
 * already set — because a cached 429 health result made the router skip the only
 * tool-capable provider without ever trying it, leaving no error to report.
 * ------------------------------------------------------------------ */

let server: Server;
let baseUrl: string;
/** Flipped by the tests to make the provider healthy or unhealthy. */
let healthy = false;

beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.url?.endsWith("/models")) {
      res.writeHead(healthy ? 200 : 401, { "content-type": "application/json" });
      res.end(JSON.stringify(healthy ? { data: [] } : { error: { message: "invalid api key" } }));
      return;
    }
    if (req.url?.endsWith("/chat/completions")) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          choices: [{ message: { role: "assistant", content: null, tool_calls: [] } }],
          usage: { prompt_tokens: 1, completion_tokens: 1 },
        }),
      );
      return;
    }
    res.writeHead(404).end();
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}/v1`;
});

afterAll(() => {
  server.close();
});

/** healthRetryMs: 0 means a failed check is never trusted — always re-probed. */
const router = () =>
  new ModelRouter({
    openaiCompatibleBaseUrl: baseUrl,
    openaiCompatibleApiKey: "test",
    healthRetryMs: 0,
  });

const chat = (r: ModelRouter) =>
  r.chat([{ role: "user", content: "hello" }], [
    { type: "function", function: { name: "lookup", description: "lookup", parameters: { type: "object" } } },
  ]);

describe("ModelRouter.chat", () => {
  it("names the provider that failed instead of implying none is configured", async () => {
    healthy = false;
    const err = await chat(router()).catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toMatch(/openai-compatible/);
    expect(err.message).toMatch(/not usable right now/);
    // The old text told you to set a key that was already set.
    expect(err.message).not.toMatch(/set GROQ_API_KEY/);
  });

  it("recovers once the provider is healthy again — a cached failure does not stick", async () => {
    const r = router();
    healthy = false;
    await expect(chat(r)).rejects.toThrow(/not usable right now/);

    healthy = true;
    // Same router instance: the earlier failure must not be trusted forever.
    await expect(chat(r)).resolves.toMatchObject({ providerId: "openai-compatible" });
  });

  it("says plainly when NO tool-capable provider is configured at all", async () => {
    const bare = new ModelRouter({});
    const err = await chat(bare).catch((e: Error) => e);
    expect(err.message).toMatch(/No tool-capable model provider is configured/);
    expect(err.message).toMatch(/Providers page/);
  });
});
