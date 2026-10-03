import type { JudgeVerdict } from "@agentguard/contracts";
import { stableStringify } from "@agentguard/contracts";

/* ------------------------------------------------------------------ *
 * The isomorphic half of a receipt.
 *
 * Everything here runs unchanged in Node AND in the browser, because the whole
 * point of a receipt is that a stranger can verify it without trusting our
 * server. Keep `node:` imports — and extra dependencies — out of this file.
 *
 * Normalisation is hand-rolled rather than schema-validated on purpose: both
 * the signer and the verifier must produce byte-identical input, and the safest
 * way to guarantee that is for both to run the exact same function.
 * ------------------------------------------------------------------ */

export const RECEIPT_VERSION = "agentguard.receipt.v1" as const;
export const RECEIPT_CLAIM =
  "Evidence toward the listed controls only, from synthetic traps run in a sandbox. This is not a certification, and an untested control is not a proven-safe control.";

export type ReceiptSeverity = "medium" | "high" | "critical";
export type ReceiptLocation = "reply" | "tool_args";

export interface ReceiptDisclosure {
  canaryId: string;
  label: string;
  severity: ReceiptSeverity;
  dimension: string;
  /** The exact quoted line the agent emitted. */
  quote: string;
  where: ReceiptLocation;
}

export interface ReceiptControl {
  id: string;
  label: string;
  /** Trials actually run. Always >= 1; a bound is never printed from zero runs. */
  trials: number;
  violations: number;
  /** Clopper–Pearson upper 95% confidence bound on the violation rate. */
  upperBound95: number;
  /** What this bound covers, so a number is never shown bare. */
  boundScope: string;
  attackLibraryVersion: string;
  /** Every dimension this control did NOT exercise. */
  notCovered: string[];
}

export interface ReceiptPayload {
  version: typeof RECEIPT_VERSION;
  /** sha256 over agent identity + posture + trap set. Changes when any of them change. */
  fingerprint: string;
  /** Ledger key: one row per agent identity. */
  identity: string;
  agentId: string;
  agentName: string;
  issuedAt: string;
  verdict: JudgeVerdict;
  controls: ReceiptControl[];
  disclosures: ReceiptDisclosure[];
  notCovered: string[];
  claim: string;
  keyNote: string;
  previousFingerprint: string | null;
  supersedes: string | null;
  /** SPKI DER, base64url — so a verifier needs nothing from us. */
  publicKey: string;
}

export interface Receipt extends ReceiptPayload {
  signature: string;
}

const SEVERITIES: ReceiptSeverity[] = ["medium", "high", "critical"];

function str(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function num(value: unknown, fallback = 0): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function severity(value: unknown): ReceiptSeverity {
  return SEVERITIES.includes(value as ReceiptSeverity) ? (value as ReceiptSeverity) : "medium";
}

function strArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

function normalizeDisclosure(raw: unknown): ReceiptDisclosure {
  const r = (raw ?? {}) as Record<string, unknown>;
  return {
    canaryId: str(r.canaryId),
    label: str(r.label),
    severity: severity(r.severity),
    dimension: str(r.dimension),
    quote: str(r.quote),
    where: r.where === "tool_args" ? "tool_args" : "reply",
  };
}

function normalizeControl(raw: unknown): ReceiptControl {
  const r = (raw ?? {}) as Record<string, unknown>;
  return {
    id: str(r.id),
    label: str(r.label),
    trials: num(r.trials, 1),
    violations: num(r.violations, 0),
    upperBound95: num(r.upperBound95, 0),
    boundScope: str(r.boundScope),
    attackLibraryVersion: str(r.attackLibraryVersion),
    notCovered: strArray(r.notCovered),
  };
}

function normalizeVerdict(raw: unknown): JudgeVerdict {
  const r = (raw ?? {}) as Record<string, unknown>;
  const dimensions = Array.isArray(r.dimensions) ? r.dimensions : [];
  return {
    starRating: num(r.starRating, 0),
    headline: str(r.headline),
    explanation: str(r.explanation),
    dimensions: dimensions.map((entry) => {
      const d = (entry ?? {}) as Record<string, unknown>;
      return {
        name: str(d.name),
        triggered: d.triggered === true,
        quotedMessage: str(d.quotedMessage),
        reasoning: str(d.reasoning),
      };
    }),
    citedEvidenceId: typeof r.citedEvidenceId === "string" ? r.citedEvidenceId : null,
    providerId: str(r.providerId, "unknown"),
    providerKind: str(r.providerKind, "unknown"),
    reconciled: r.reconciled === true,
    capApplied: typeof r.capApplied === "string" ? r.capApplied : null,
  };
}

/**
 * Produce the canonical payload shape. The signer and the verifier both call
 * this, which is what makes the signed bytes reproducible across languages and
 * runtimes.
 */
export function normalizePayload(raw: unknown): ReceiptPayload {
  const r = (raw ?? {}) as Record<string, unknown>;
  return {
    version: RECEIPT_VERSION,
    fingerprint: str(r.fingerprint),
    identity: str(r.identity),
    agentId: str(r.agentId),
    agentName: str(r.agentName),
    issuedAt: str(r.issuedAt),
    verdict: normalizeVerdict(r.verdict),
    controls: (Array.isArray(r.controls) ? r.controls : []).map(normalizeControl),
    disclosures: (Array.isArray(r.disclosures) ? r.disclosures : []).map(normalizeDisclosure),
    notCovered: strArray(r.notCovered),
    claim: str(r.claim, RECEIPT_CLAIM),
    keyNote: str(r.keyNote),
    previousFingerprint: typeof r.previousFingerprint === "string" ? r.previousFingerprint : null,
    supersedes: typeof r.supersedes === "string" ? r.supersedes : null,
    publicKey: str(r.publicKey),
  };
}

export function normalizeReceipt(raw: unknown): Receipt {
  const r = (raw ?? {}) as Record<string, unknown>;
  return { ...normalizePayload(r), signature: str(r.signature) };
}

/** Recursively key-sorted JSON, so re-serialisation can never change the signed bytes. */
export function canonicalJson(value: unknown): string {
  return stableStringify(value);
}

export function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromBase64Url(text: string): Uint8Array<ArrayBuffer> {
  const normalised = text.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalised.padEnd(normalised.length + ((4 - (normalised.length % 4)) % 4), "=");
  const binary = atob(padded);
  // Allocate over an explicit ArrayBuffer so the result is a valid BufferSource.
  const out = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

/** The exact bytes that get signed, derived only from the normalised payload. */
export function signableBytes(payload: unknown): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(canonicalJson(normalizePayload(payload)));
}

/**
 * Verify a receipt signature client-side against the public key it carries.
 * Returns false rather than throwing: a failed verification is a result, not an
 * exception, and a bad receipt must never look like an unavailable server.
 */
export async function verifyReceiptSignature(receipt: unknown): Promise<boolean> {
  try {
    const normalised = normalizeReceipt(receipt);
    if (!normalised.signature || !normalised.publicKey) return false;
    const key = await globalThis.crypto.subtle.importKey(
      "spki",
      fromBase64Url(normalised.publicKey),
      { name: "Ed25519" },
      false,
      ["verify"],
    );
    return await globalThis.crypto.subtle.verify(
      "Ed25519",
      key,
      fromBase64Url(normalised.signature),
      signableBytes(normalised),
    );
  } catch {
    return false;
  }
}

/**
 * A fingerprint that dies the moment the agent or the trap set changes — the
 * "inspection sticker that expires when the car changes".
 */
export function fingerprintParts(input: {
  agentId: string;
  manifestDigest: string;
  trapIds: string[];
  attackLibraryVersion: string;
}): string {
  return canonicalJson({
    agentId: input.agentId,
    manifestDigest: input.manifestDigest,
    trapIds: [...input.trapIds].sort(),
    attackLibraryVersion: input.attackLibraryVersion,
  });
}
