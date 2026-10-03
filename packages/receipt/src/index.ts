import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign as nodeSign, verify as nodeVerify, type KeyObject } from "node:crypto";
import { deflateRawSync, inflateRawSync } from "node:zlib";
import type { JudgeVerdict } from "@agentguard/contracts";
import {
  RECEIPT_CLAIM,
  RECEIPT_VERSION,
  type Receipt,
  type ReceiptControl,
  type ReceiptDisclosure,
  canonicalJson,
  fingerprintParts,
  fromBase64Url,
  normalizePayload,
  signableBytes,
  toBase64Url,
  verifyReceiptSignature,
} from "./shared.js";

export * from "./shared.js";
export * from "./ledger.js";

/* ------------------------------------------------------------------ *
 * Server-side receipt issuance.
 * ------------------------------------------------------------------ */

/** PKCS#8 wrapper for a raw Ed25519 seed (RFC 8410). */
const PKCS8_ED25519_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");

export interface SigningKey {
  privateKey: KeyObject;
  publicKeyBase64Url: string;
  keyNote: string;
}

function fromSeed(seedHex: string): SigningKey {
  const seed = Buffer.from(seedHex.trim(), "hex");
  if (seed.length !== 32) {
    throw new Error(`RECEIPT_SIGNING_SEED must be 32 bytes of hex (got ${seed.length}).`);
  }
  const privateKey = createPrivateKey({
    key: Buffer.concat([PKCS8_ED25519_PREFIX, seed]),
    format: "der",
    type: "pkcs8",
  });
  const spki = createPublicKey(privateKey).export({ type: "spki", format: "der" }) as Buffer;
  return { privateKey, publicKeyBase64Url: toBase64Url(spki), keyNote: "operator-supplied signing key" };
}

let cachedKey: SigningKey | null = null;

/**
 * Load the signing key. With no configured seed we generate one at boot and say
 * so on the face of every receipt — a demo key is never presented as a KMS key,
 * and it rotates on restart, which is exactly what `key_note` warns about.
 */
export function loadSigningKey(env: NodeJS.ProcessEnv = process.env): SigningKey {
  const seed = env.RECEIPT_SIGNING_SEED;
  if (seed && seed.trim() !== "") return fromSeed(seed);
  if (cachedKey) return cachedKey;
  const { privateKey } = generateKeyPairSync("ed25519");
  const spki = createPublicKey(privateKey).export({ type: "spki", format: "der" }) as Buffer;
  cachedKey = {
    privateKey,
    publicKeyBase64Url: toBase64Url(spki),
    keyNote: "demo key, not KMS — rotates when the server restarts",
  };
  return cachedKey;
}

/** Reset the cached demo key. Test-only. */
export function resetSigningKeyCache(): void {
  cachedKey = null;
}

/** sha256 over the parts that define this agent's tested identity. */
export function fingerprintOf(input: {
  agentId: string;
  manifestDigest: string;
  trapIds: string[];
  attackLibraryVersion: string;
}): string {
  return "sha256:" + createHash("sha256").update(fingerprintParts(input)).digest("hex");
}

export function attackLibraryVersionOf(library: unknown): string {
  return "sha256:" + createHash("sha256").update(canonicalJson(library)).digest("hex");
}

function binomPmf(k: number, n: number, p: number): number {
  if (p <= 0) return k === 0 ? 1 : 0;
  if (p >= 1) return k === n ? 1 : 0;
  let logChoose = 0;
  for (let i = 1; i <= k; i++) logChoose += Math.log(n - k + i) - Math.log(i);
  return Math.exp(logChoose + k * Math.log(p) + (n - k) * Math.log(1 - p));
}

/**
 * Clopper–Pearson upper 95% confidence bound on the violation rate.
 *
 * This is the reason a receipt can never print a bare percentage from a single
 * run: with one trial the bound is wide and honest, and with zero trials it
 * throws rather than inventing a number.
 */
export function upperBound95(violations: number, trials: number): number {
  if (!Number.isInteger(trials) || trials < 1) {
    throw new Error("upperBound95 requires at least one trial — a bound cannot be computed from zero observations.");
  }
  if (!Number.isInteger(violations) || violations < 0 || violations > trials) {
    throw new Error(`upperBound95: violations (${violations}) must be an integer between 0 and trials (${trials}).`);
  }
  if (violations === trials) return 1;

  const alpha = 0.05; // one-sided 95% upper bound
  const cdf = (p: number): number => {
    let sum = 0;
    for (let i = 0; i <= violations; i++) sum += binomPmf(i, trials, p);
    return sum;
  };
  // P(X <= violations) decreases monotonically in p; solve cdf(p) = alpha.
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (cdf(mid) > alpha) lo = mid;
    else hi = mid;
  }
  return Math.min(1, Math.max(0, (lo + hi) / 2));
}

export interface BuildReceiptInput {
  identity: string;
  agentId: string;
  agentName: string;
  manifestDigest: string;
  trapIds: string[];
  attackLibraryVersion: string;
  verdict: JudgeVerdict;
  controls: ReceiptControl[];
  disclosures: ReceiptDisclosure[];
  /** Every dimension in the registry, so we can report what was NOT covered. */
  allDimensions: string[];
  coveredDimensions?: string[];
  previousFingerprint?: string | null;
  key?: SigningKey;
}

export function buildReceipt(input: BuildReceiptInput): Receipt {
  const key = input.key ?? loadSigningKey();
  const fingerprint = fingerprintOf({
    agentId: input.agentId,
    manifestDigest: input.manifestDigest,
    trapIds: input.trapIds,
    attackLibraryVersion: input.attackLibraryVersion,
  });
  const covered = new Set(input.coveredDimensions ?? []);
  const notCovered = input.allDimensions.filter((d) => !covered.has(d));

  const payload = normalizePayload({
    version: RECEIPT_VERSION,
    fingerprint,
    identity: input.identity,
    agentId: input.agentId,
    agentName: input.agentName,
    issuedAt: new Date().toISOString(),
    verdict: input.verdict,
    controls: input.controls,
    disclosures: input.disclosures,
    notCovered,
    claim: RECEIPT_CLAIM,
    keyNote: key.keyNote,
    previousFingerprint: input.previousFingerprint ?? null,
    supersedes: input.previousFingerprint ?? null,
    publicKey: key.publicKeyBase64Url,
  });

  const signature = nodeSign(null, signableBytes(payload), key.privateKey).toString("base64url");
  return { ...payload, signature };
}

/** Verify with the Node crypto stack. The browser uses `verifyReceiptSignature`. */
export function verifyReceiptNode(receipt: Receipt): boolean {
  try {
    const { signature, ...rest } = receipt;
    const payload = normalizePayload(rest);
    const publicKey = createPublicKey({ key: Buffer.from(fromBase64Url(payload.publicKey)), format: "der", type: "spki" });
    return nodeVerify(null, signableBytes(payload), publicKey, Buffer.from(fromBase64Url(signature)));
  } catch {
    return false;
  }
}

/** Compact, URL-safe transport form of a whole receipt (zlib + base64url). */
export function encodeReceipt(receipt: Receipt): string {
  return toBase64Url(deflateRawSync(Buffer.from(JSON.stringify(receipt), "utf8")));
}

export function decodeReceipt(encoded: string): Receipt {
  const json = inflateRawSync(Buffer.from(fromBase64Url(encoded))).toString("utf8");
  return JSON.parse(json) as Receipt;
}

export { verifyReceiptSignature };
