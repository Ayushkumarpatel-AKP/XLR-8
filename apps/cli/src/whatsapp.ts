import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { isAllowed, sendText, verifySignature, type OpenWaConfig } from "./openwa.js";

/* ------------------------------------------------------------------ *
 * The WhatsApp bridge.
 *
 * OpenWA delivers a webhook per incoming message; this receives it, decides
 * whether the sender is allowed to talk to the robot, gets an answer, and sends
 * it back. The answering itself is injected (`answer`), so the brain stays where
 * it already is and this file stays a channel adapter.
 *
 * Three decisions worth knowing:
 *
 *  - It binds to 127.0.0.1 unless told otherwise. The webhook carries message
 *    content, and OpenWA is a local service; there is no reason for this to be
 *    reachable from anywhere else.
 *  - The allowlist is the primary control and it fails closed: with nobody
 *    configured, nobody gets an answer.
 *  - The HTTP response is sent BEFORE the answer is worked out. OpenWA retries a
 *    slow or non-2xx delivery, and thinking about a security question takes
 *    seconds — answering synchronously would deliver every reply twice.
 * ------------------------------------------------------------------ */

export interface BridgeOptions {
  cfg: OpenWaConfig;
  /** The resolved session the bridge speaks through. */
  sessionId: string;
  /** Bare digit strings; matching is on the last ten digits. Empty = nobody. */
  allow: readonly string[];
  port: number;
  host: string;
  /** Answer one utterance. The caller owns the brain. */
  answer: (text: string) => Promise<string>;
  log: (line: string) => void;
}

export interface Bridge {
  readonly url: string;
  close: () => Promise<void>;
}

/** Dig the sender, the chat and the text out of whatever OpenWA delivered. */
function readMessage(payload: Record<string, unknown>): { from: string; chatId: string; text: string } | null {
  const asRecord = (v: unknown): Record<string, unknown> =>
    v && typeof v === "object" ? (v as Record<string, unknown>) : {};

  const data = asRecord(payload.data ?? payload.payload ?? payload);
  const key = asRecord(data.key);
  const message = asRecord(data.message);

  const pick = (...values: unknown[]): string => {
    for (const v of values) if (typeof v === "string" && v.trim()) return v;
    return "";
  };

  const chatId = pick(data.chatId, data.from, key.remoteJid, data.remoteJid);
  const from = pick(data.author, data.from, key.participant, key.remoteJid, data.remoteJid);
  const text = pick(
    data.body,
    data.text,
    message.conversation,
    asRecord(message.extendedTextMessage).text,
    asRecord(message.imageMessage).caption,
    asRecord(message.videoMessage).caption,
  );

  if (!chatId || !from || !text) return null;
  return { from, chatId, text };
}

function readEvent(payload: Record<string, unknown>): string {
  const v = payload.event ?? payload.type ?? payload.eventType;
  return typeof v === "string" ? v : "";
}

function readFlag(payload: Record<string, unknown>, name: string): boolean {
  const asRecord = (v: unknown): Record<string, unknown> =>
    v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  const data = asRecord(payload.data ?? payload.payload ?? payload);
  return (data[name] ?? payload[name]) === true;
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

const json = (res: ServerResponse, status: number, body: unknown): void => {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
};

export async function startBridge(opts: BridgeOptions): Promise<Bridge> {
  const seen = new Set<string>();
  /** Only the recent ids matter; this bounds memory on a long-running bridge. */
  const remember = (id: string): boolean => {
    if (seen.has(id)) return true;
    seen.add(id);
    if (seen.size > 2000) for (const old of [...seen].slice(0, 1000)) seen.delete(old);
    return false;
  };

  const server: Server = createServer((req, res) => {
    void (async () => {
      if (req.method !== "POST") return json(res, 405, { error: "POST only" });

      const raw = await readBody(req);

      // Signature first, over the RAW body: re-serialising parsed JSON would
      // change the bytes and never match.
      if (opts.cfg.webhookSecret) {
        const header = req.headers["x-openwa-signature"];
        if (!verifySignature(raw, Array.isArray(header) ? header[0] : header, opts.cfg.webhookSecret)) {
          opts.log("rejected a delivery whose signature did not match.");
          return json(res, 401, { error: "bad signature" });
        }
      }

      let payload: Record<string, unknown>;
      try {
        payload = JSON.parse(raw) as Record<string, unknown>;
      } catch {
        return json(res, 400, { error: "body was not JSON" });
      }

      const idem = req.headers["x-openwa-idempotency-key"];
      const id = Array.isArray(idem) ? idem[0] : idem;
      if (id && remember(id)) return json(res, 200, { ok: true, duplicate: true });

      const event = readEvent(payload);
      if (!/message/i.test(event)) return json(res, 200, { ok: true, ignored: event || "unknown event" });
      if (readFlag(payload, "fromMe")) return json(res, 200, { ok: true, ignored: "our own message" });

      const msg = readMessage(payload);
      if (!msg) {
        // Worth seeing once: OpenWA's delivered shape is not in its OpenAPI spec.
        opts.log(`could not read a message out of this delivery: ${raw.slice(0, 400)}`);
        return json(res, 200, { ok: true, ignored: "unreadable payload" });
      }

      if (/@g\.us$/.test(msg.chatId)) return json(res, 200, { ok: true, ignored: "group chat" });

      if (!isAllowed(msg.from, opts.allow)) {
        opts.log(`ignored a message from ${msg.from} — not in WHATSAPP_ALLOWED_NUMBERS.`);
        return json(res, 200, { ok: true, ignored: "sender not allowed" });
      }

      // Accepted. Answer in the background: OpenWA retries anything slow.
      json(res, 200, { ok: true });
      void (async () => {
        try {
          opts.log(`← ${msg.text}`);
          const reply = await opts.answer(msg.text);
          opts.log(`→ ${reply.replace(/\n+/g, " ").slice(0, 120)}`);
          await sendText(opts.cfg, opts.sessionId, msg.chatId, reply);
        } catch (err) {
          const why = (err as Error).message;
          opts.log(`could not answer that message: ${why}`);
          // Say so in the channel rather than leaving the sender waiting, but
          // never pretend the robot answered.
          await sendText(opts.cfg, opts.sessionId, msg.chatId, `I could not answer that: ${why}`).catch(
            () => undefined,
          );
        }
      })();
      return undefined;
    })().catch((err) => {
      opts.log(`bridge error: ${(err as Error).message}`);
      if (!res.headersSent) json(res, 500, { error: "internal" });
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(opts.port, opts.host, resolve);
  });

  // The bound port, not the requested one: port 0 means "any free port", and a
  // URL built from the request would name :0.
  const bound = server.address();
  const port = typeof bound === "object" && bound ? bound.port : opts.port;

  return {
    url: `http://${opts.host === "0.0.0.0" ? "127.0.0.1" : opts.host}:${port}/whatsapp`,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
}
