import { createHmac } from "node:crypto";
import { createServer, type Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startBridge, type Bridge } from "../apps/cli/src/whatsapp.js";
import type { OpenWaConfig } from "../apps/cli/src/openwa.js";

/**
 * The whole loop, against a stand-in for the gateway.
 *
 * Every rule that decides whether a message becomes an answer is exercised here
 * — signature, allowlist, duplicates, groups — and the reply is observed
 * arriving at the fake OpenWA. WhatsApp is never involved, so this runs anywhere
 * and proves the bridge before a number is ever linked.
 */

interface Sent {
  chatId: string;
  text: string;
}

const SECRET = "shared-secret";
const allowed = ["8959518909"];

let gateway: Server;
let gatewayUrl = "";
let sent: Sent[] = [];
let bridge: Bridge | null = null;
let logs: string[] = [];

/** A minimal OpenWA: it only has to accept a send and remember it. */
async function startFakeGateway(): Promise<void> {
  gateway = createServer((req, res) => {
    const url = req.url ?? "";
    if (req.method === "POST" && /messages\/send-text$/.test(url)) {
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => chunks.push(c));
      req.on("end", () => {
        sent.push(JSON.parse(Buffer.concat(chunks).toString("utf8")) as Sent);
        res.writeHead(201, { "content-type": "application/json" });
        res.end(JSON.stringify({ messageId: "msg_test", timestamp: 0 }));
      });
      return;
    }
    res.writeHead(404).end("{}");
  });
  await new Promise<void>((resolve) => gateway.listen(0, "127.0.0.1", resolve));
  const addr = gateway.address();
  gatewayUrl = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
}

function post(body: unknown, headers: Record<string, string> = {}): Promise<Response> {
  const raw = JSON.stringify(body);
  const signature = `sha256=${createHmac("sha256", SECRET).update(raw, "utf8").digest("hex")}`;
  return fetch(bridge!.url, {
    method: "POST",
    headers: { "content-type": "application/json", "x-openwa-signature": signature, ...headers },
    body: raw,
  });
}

/** A delivery shaped like the ones OpenWA sends. */
const delivery = (over: Record<string, unknown> = {}) => ({
  event: "message.received",
  data: { from: "918959518909@c.us", chatId: "918959518909@c.us", body: "how many agents?", fromMe: false, ...over },
});

/** The send happens after the 200, so give it a tick to land. */
const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 60));

beforeEach(async () => {
  sent = [];
  logs = [];
  await startFakeGateway();
  const cfg: OpenWaConfig = {
    baseUrl: gatewayUrl,
    apiKey: "owa_k1_test",
    sessionName: "agentguard",
    webhookSecret: SECRET,
  };
  bridge = await startBridge({
    cfg,
    sessionId: "sess_test",
    allow: allowed,
    port: 0,
    host: "127.0.0.1",
    answer: async (text) => `You asked: ${text}`,
    log: (line) => logs.push(line),
  });
});

afterEach(async () => {
  await bridge?.close();
  bridge = null;
  await new Promise<void>((resolve) => gateway.close(() => resolve()));
});

describe("whatsapp bridge", () => {
  it("answers an allowed sender, and sends the reply back", async () => {
    const res = await post(delivery());
    expect(res.status).toBe(200);
    await settle();

    expect(sent).toHaveLength(1);
    expect(sent[0]!.chatId).toBe("918959518909@c.us");
    expect(sent[0]!.text).toBe("You asked: how many agents?");
  });

  /**
   * The 200 goes out before the answer is worked out. OpenWA retries a slow
   * delivery, so answering first would deliver every reply twice.
   */
  it("acknowledges before computing the answer", async () => {
    let answered = false;
    await bridge!.close();
    bridge = await startBridge({
      cfg: { baseUrl: gatewayUrl, apiKey: "k", sessionName: "agentguard", webhookSecret: SECRET },
      sessionId: "sess_test",
      allow: allowed,
      port: 0,
      host: "127.0.0.1",
      answer: async () => {
        await new Promise((r) => setTimeout(r, 80));
        answered = true;
        return "late";
      },
      log: (line) => logs.push(line),
    });

    const res = await post(delivery());
    expect(res.status).toBe(200);
    expect(answered).toBe(false); // the response did not wait for it
    await new Promise((r) => setTimeout(r, 150));
    expect(answered).toBe(true);
  });

  it("ignores anyone not on the allowlist, and says so", async () => {
    const res = await post(delivery({ from: "919999999999@c.us", chatId: "919999999999@c.us" }));
    expect(res.status).toBe(200);
    await settle();

    expect(sent).toHaveLength(0);
    expect(logs.join("\n")).toContain("not in WHATSAPP_ALLOWED_NUMBERS");
  });

  it("ignores a group chat", async () => {
    await post(delivery({ chatId: "1234567890-123@g.us" }));
    await settle();
    expect(sent).toHaveLength(0);
  });

  it("ignores its own message, so it cannot answer itself forever", async () => {
    await post(delivery({ fromMe: true }));
    await settle();
    expect(sent).toHaveLength(0);
  });

  it("delivers once for a retried delivery — OpenWA retries on a hiccup", async () => {
    const headers = { "x-openwa-idempotency-key": "abc-123" };
    await post(delivery(), headers);
    await post(delivery(), headers);
    await settle();

    expect(sent).toHaveLength(1);
  });

  it("refuses a delivery that is not signed with the shared secret", async () => {
    const raw = JSON.stringify(delivery());
    const res = await fetch(bridge!.url, {
      method: "POST",
      headers: { "content-type": "application/json", "x-openwa-signature": "sha256=deadbeef" },
      body: raw,
    });

    expect(res.status).toBe(401);
    await settle();
    expect(sent).toHaveLength(0);
  });

  it("refuses a delivery with no signature at all when a secret is set", async () => {
    const res = await fetch(bridge!.url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(delivery()),
    });

    expect(res.status).toBe(401);
    await settle();
    expect(sent).toHaveLength(0);
  });

  it("still answers when no secret is configured — the allowlist is the control then", async () => {
    await bridge!.close();
    bridge = await startBridge({
      cfg: { baseUrl: gatewayUrl, apiKey: "k", sessionName: "agentguard", webhookSecret: null },
      sessionId: "sess_test",
      allow: allowed,
      port: 0,
      host: "127.0.0.1",
      answer: async () => "unsigned but allowed",
      log: (line) => logs.push(line),
    });

    const res = await fetch(bridge!.url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(delivery()),
    });
    expect(res.status).toBe(200);
    await settle();
    expect(sent).toHaveLength(1);
  });

  it("answers nobody when the allowlist is empty", async () => {
    await bridge!.close();
    bridge = await startBridge({
      cfg: { baseUrl: gatewayUrl, apiKey: "k", sessionName: "agentguard", webhookSecret: SECRET },
      sessionId: "sess_test",
      allow: [],
      port: 0,
      host: "127.0.0.1",
      answer: async () => "should never be sent",
      log: (line) => logs.push(line),
    });

    await post(delivery());
    await settle();
    expect(sent).toHaveLength(0);
  });

  it("tells the sender when the robot could not answer, rather than going quiet", async () => {
    await bridge!.close();
    bridge = await startBridge({
      cfg: { baseUrl: gatewayUrl, apiKey: "k", sessionName: "agentguard", webhookSecret: SECRET },
      sessionId: "sess_test",
      allow: allowed,
      port: 0,
      host: "127.0.0.1",
      answer: async () => {
        throw new Error("provider unreachable");
      },
      log: (line) => logs.push(line),
    });

    await post(delivery());
    await settle();

    // The failure is still a send, and it does not pretend to be an answer.
    expect(sent).toHaveLength(1);
    expect(sent[0]!.text).toContain("could not answer");
    expect(sent[0]!.text).toContain("provider unreachable");
  });
});
