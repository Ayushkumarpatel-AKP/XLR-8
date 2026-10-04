import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  allowedNumbers,
  chatIdFor,
  isAllowed,
  openwaConfig,
  verifySignature,
} from "../apps/cli/src/openwa.js";

/**
 * The parts of the WhatsApp bridge that decide who gets answered and whether a
 * delivery is genuine. Nothing here touches the network — these are the rules
 * that have to hold even when OpenWA is unreachable or hostile.
 */
describe("openwa configuration", () => {
  it("is unconfigured without a key, so the command can refuse honestly", () => {
    expect(openwaConfig({})).toBeNull();
    expect(openwaConfig({ OPENWA_API_KEY: "  " })).toBeNull();
  });

  it("defaults the base URL and session name", () => {
    const cfg = openwaConfig({ OPENWA_API_KEY: "owa_k1_x" })!;
    expect(cfg.baseUrl).toBe("http://localhost:2785");
    expect(cfg.sessionName).toBe("agentguard");
  });

  it("strips a trailing slash so paths do not double up", () => {
    const cfg = openwaConfig({ OPENWA_API_KEY: "k", OPENWA_BASE_URL: "http://box:2785/" })!;
    expect(cfg.baseUrl).toBe("http://box:2785");
  });

  it("leaves the webhook secret null when unset — an empty string is not a secret", () => {
    expect(openwaConfig({ OPENWA_API_KEY: "k" })!.webhookSecret).toBeNull();
    expect(openwaConfig({ OPENWA_API_KEY: "k", OPENWA_WEBHOOK_SECRET: "  " })!.webhookSecret).toBeNull();
    expect(openwaConfig({ OPENWA_API_KEY: "k", OPENWA_WEBHOOK_SECRET: "s3cret" })!.webhookSecret).toBe("s3cret");
  });
});

describe("who is allowed to talk to the robot", () => {
  it("fails closed: nobody is allowed when nobody is configured", () => {
    expect(allowedNumbers({})).toEqual([]);
    expect(isAllowed("918959518909@c.us", [])).toBe(false);
  });

  it("parses a comma-separated list and keeps only digits", () => {
    expect(allowedNumbers({ WHATSAPP_ALLOWED_NUMBERS: "+91 89595 18909, 98765-43210" })).toEqual([
      "918959518909",
      "9876543210",
    ]);
  });

  /**
   * The same person arrives as `918959518909@c.us`, `8959518909@s.whatsapp.net`
   * or a mapped `@lid`, and a human typing their own number leaves the country
   * code off. Matching the last ten digits is what makes those the same person.
   */
  it("matches on the last ten digits, so a country code may be omitted", () => {
    expect(isAllowed("918959518909@c.us", ["8959518909"])).toBe(true);
    expect(isAllowed("8959518909@s.whatsapp.net", ["8959518909"])).toBe(true);
    expect(isAllowed("918959518909:12@lid", ["8959518909"])).toBe(true);
  });

  it("does not let a short entry match everyone ending in it", () => {
    // "8909" must be exact, not a suffix of a longer number.
    expect(isAllowed("918959518909@c.us", ["8909"])).toBe(false);
  });

  it("refuses a number that is not on the list, however similar", () => {
    expect(isAllowed("918959518910@c.us", ["8959518909"])).toBe(false);
    expect(isAllowed("", ["8959518909"])).toBe(false);
  });

  it("writes a chat id in the dialect OpenWA expects", () => {
    expect(chatIdFor("+91 89595 18909")).toBe("918959518909@c.us");
  });
});

describe("webhook signature", () => {
  const secret = "a-shared-secret";
  const body = JSON.stringify({ event: "message.received", data: { body: "hi" } });
  const sign = (raw: string, key = secret): string =>
    `sha256=${createHmac("sha256", key).update(raw, "utf8").digest("hex")}`;

  it("accepts a delivery signed over the exact raw body", () => {
    expect(verifySignature(body, sign(body), secret)).toBe(true);
  });

  it("refuses anything not signed with the shared secret", () => {
    expect(verifySignature(body, sign(body, "the-wrong-secret"), secret)).toBe(false);
  });

  /** The reason the raw body is kept: re-serialising changes the bytes. */
  it("refuses a signature over re-serialised JSON", () => {
    const reserialised = JSON.stringify(JSON.parse(body));
    const respaced = JSON.stringify({ event: "message.received", data: { body: "hi" } }, null, 2);
    expect(verifySignature(respaced, sign(reserialised), secret)).toBe(false);
  });

  it("refuses a missing, malformed or unhexable header", () => {
    expect(verifySignature(body, undefined, secret)).toBe(false);
    expect(verifySignature(body, "", secret)).toBe(false);
    expect(verifySignature(body, "sha256=", secret)).toBe(false);
    expect(verifySignature(body, "sha256=zzzz", secret)).toBe(false);
    expect(verifySignature(body, "not-even-the-right-scheme", secret)).toBe(false);
  });
});
