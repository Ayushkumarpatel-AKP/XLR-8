import { createHmac, timingSafeEqual } from "node:crypto";

/* ------------------------------------------------------------------ *
 * OpenWA — the WhatsApp gateway.
 *
 * OpenWA is a self-hosted, unofficial WhatsApp API (reverse-engineered clients,
 * not Meta's Cloud API). This module is only the parts AgentGuard needs: know
 * which sessions exist, link one, point its webhook at us, and send a reply.
 *
 * Two facts from its own API shape everything here:
 *
 *  - A send returns 201 as soon as the gateway hands the message to WhatsApp.
 *    201 means ACCEPTED, never delivered, so nothing in this file reports a
 *    message as delivered.
 *  - A webhook is signed `X-OpenWA-Signature: sha256=<hex>` over the raw body,
 *    and carries `X-OpenWA-Idempotency-Key` because deliveries are retried.
 * ------------------------------------------------------------------ */

export interface OpenWaConfig {
  /** Origin of the gateway, without the /api suffix, e.g. http://localhost:2785 */
  baseUrl: string;
  apiKey: string;
  /** The session the bridge speaks through. Resolved from a name on first use. */
  sessionName: string;
  /** HMAC secret for the webhook, when one is set. */
  webhookSecret: string | null;
}

export interface OpenWaSession {
  id: string;
  name: string;
  status: string;
  phone: string | null;
  lastError: string | null;
}

/** Session statuses as OpenWA documents them. */
export type SessionStatus =
  | "created"
  | "initializing"
  | "qr_ready"
  | "authenticating"
  | "ready"
  | "disconnected"
  | "action_required"
  | "failed";

export class OpenWaError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "OpenWaError";
  }
}

const trim = (v: string | undefined): string => (v ?? "").trim();

/** The configuration, or null when the gateway is not set up at all. */
export function openwaConfig(env: NodeJS.ProcessEnv = process.env): OpenWaConfig | null {
  const apiKey = trim(env.OPENWA_API_KEY);
  if (!apiKey) return null;
  return {
    baseUrl: (trim(env.OPENWA_BASE_URL) || "http://localhost:2785").replace(/\/+$/, ""),
    apiKey,
    sessionName: trim(env.OPENWA_SESSION) || "agentguard",
    webhookSecret: trim(env.OPENWA_WEBHOOK_SECRET) || null,
  };
}

/**
 * Who is allowed to talk to the bot, as bare digit strings.
 *
 * Matching is on the LAST TEN digits, because the same person arrives as
 * `918959518909@c.us`, `8959518909@s.whatsapp.net` or a mapped `@lid` depending
 * on the engine, and a country code is exactly what a human typing their own
 * number leaves out. A shorter allowlist entry would match too broadly, so
 * anything under ten digits is kept but compared exactly.
 */
export function allowedNumbers(env: NodeJS.ProcessEnv = process.env): string[] {
  return trim(env.WHATSAPP_ALLOWED_NUMBERS)
    .split(",")
    .map((n) => n.replace(/\D/g, ""))
    .filter(Boolean);
}

/**
 * Does this sender match the allowlist? An empty allowlist allows nobody.
 *
 * The `@host` and any `:device` suffix are dropped first: a lid arrives as
 * `918959518909:12@lid` and a contact as `918959518909@c.us`, and those are the
 * same person. What is left is compared as digits.
 */
export function isAllowed(sender: string, allow: readonly string[]): boolean {
  const digits = String(sender).split("@")[0]!.split(":")[0]!.replace(/\D/g, "");
  if (!digits) return false;
  return allow.some((entry) => (entry.length >= 10 ? digits.endsWith(entry) : digits === entry));
}

/** The chat id for a phone number, in the dialect OpenWA writes. */
export function chatIdFor(phone: string): string {
  return `${phone.replace(/\D/g, "")}@c.us`;
}

/**
 * Verify an OpenWA webhook signature.
 *
 * `X-OpenWA-Signature` is `sha256=<hex>` over the RAW body — re-serialising the
 * parsed JSON would change the bytes and never match.
 */
export function verifySignature(rawBody: string, header: string | undefined, secret: string): boolean {
  if (!header) return false;
  const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
  const given = header.replace(/^sha256=/i, "").trim();
  if (given.length !== expected.length) return false;
  try {
    return timingSafeEqual(Buffer.from(given, "hex"), Buffer.from(expected, "hex"));
  } catch {
    return false;
  }
}

async function call<T>(
  cfg: OpenWaConfig,
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const res = await fetch(`${cfg.baseUrl}/api${path}`, {
    method,
    headers: { "X-API-Key": cfg.apiKey, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(20_000),
  });
  const text = await res.text();
  if (!res.ok) {
    // OpenWA's own message is the useful part; keep it rather than inventing one.
    let detail = text.slice(0, 300);
    try {
      const j = JSON.parse(text) as { message?: string | string[] };
      if (j.message) detail = Array.isArray(j.message) ? j.message.join("; ") : j.message;
    } catch {
      /* not JSON — the raw text is the message */
    }
    throw new OpenWaError(res.status, detail || res.statusText);
  }
  return (text ? JSON.parse(text) : undefined) as T;
}

export async function listSessions(cfg: OpenWaConfig): Promise<OpenWaSession[]> {
  return call<OpenWaSession[]>(cfg, "GET", "/sessions");
}

/** The session by name, creating it when it does not exist yet. */
export async function ensureSession(cfg: OpenWaConfig): Promise<OpenWaSession> {
  const existing = (await listSessions(cfg)).find((s) => s.name === cfg.sessionName);
  if (existing) return existing;
  return call<OpenWaSession>(cfg, "POST", "/sessions", { name: cfg.sessionName });
}

export async function getSession(cfg: OpenWaConfig, sessionId: string): Promise<OpenWaSession> {
  return call<OpenWaSession>(cfg, "GET", `/sessions/${sessionId}`);
}

export async function startSession(cfg: OpenWaConfig, sessionId: string): Promise<OpenWaSession> {
  return call<OpenWaSession>(cfg, "POST", `/sessions/${sessionId}/start`);
}

/** The QR to scan, as a PNG data URL, or null when it is not ready yet. */
export async function sessionQr(cfg: OpenWaConfig, sessionId: string): Promise<string | null> {
  try {
    const r = await call<{ qrCode?: string }>(cfg, "GET", `/sessions/${sessionId}/qr`);
    return r.qrCode ?? null;
  } catch (err) {
    // 400 here just means "not waiting to be linked", which is not an error.
    if (err instanceof OpenWaError && err.status === 400) return null;
    throw err;
  }
}

export async function listWebhooks(cfg: OpenWaConfig, sessionId: string): Promise<Array<{ id: string; url: string; events: string[] }>> {
  return call(cfg, "GET", `/sessions/${sessionId}/webhooks`);
}

/**
 * Point the session's webhook at us. Replaces an existing registration for the
 * same URL rather than adding a second one, which would double every reply.
 */
export async function ensureWebhook(
  cfg: OpenWaConfig,
  sessionId: string,
  url: string,
  events: string[],
): Promise<"created" | "kept" | "updated"> {
  const existing = (await listWebhooks(cfg, sessionId)).find((w) => w.url === url);
  const body = {
    url,
    events,
    ...(cfg.webhookSecret ? { secret: cfg.webhookSecret } : {}),
  };
  if (!existing) {
    await call(cfg, "POST", `/sessions/${sessionId}/webhooks`, body);
    return "created";
  }
  await call(cfg, "PUT", `/sessions/${sessionId}/webhooks/${existing.id}`, body);
  return "updated";
}

export async function deleteWebhook(cfg: OpenWaConfig, sessionId: string, id: string): Promise<void> {
  await call(cfg, "DELETE", `/sessions/${sessionId}/webhooks/${id}`);
}

export interface SendResult {
  messageId: string;
  /** Epoch seconds. */
  timestamp: number;
}

/**
 * Send a text. A 201 means the gateway ACCEPTED it — not that anyone received
 * it — so callers must not report delivery from this.
 */
export async function sendText(
  cfg: OpenWaConfig,
  sessionId: string,
  chatId: string,
  text: string,
): Promise<SendResult> {
  // OpenWA caps a body at 4096; trim rather than let the send fail at the edge.
  const body = text.length > 4000 ? `${text.slice(0, 3997)}...` : text;
  return call<SendResult>(cfg, "POST", `/sessions/${sessionId}/messages/send-text`, { chatId, text: body });
}
