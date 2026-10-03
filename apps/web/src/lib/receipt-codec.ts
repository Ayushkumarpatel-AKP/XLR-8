import { fromBase64Url, toBase64Url, type Receipt } from "@agentguard/receipt/shared";

/* ------------------------------------------------------------------ *
 * Browser-side transport codec for receipts.
 *
 * Raw DEFLATE keeps the shareable link small enough to paste anywhere. The
 * server writes the same format with node:zlib, so a link produced on either
 * side opens on the other.
 * ------------------------------------------------------------------ */

export async function encodeReceipt(receipt: Receipt): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(receipt));
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream("deflate-raw"));
  const compressed = new Uint8Array(await new Response(stream).arrayBuffer());
  return toBase64Url(compressed);
}

export async function decodeReceipt(encoded: string): Promise<Receipt> {
  const bytes = fromBase64Url(encoded);
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  const text = await new Response(stream).text();
  return JSON.parse(text) as Receipt;
}

export function verifyUrlFor(fingerprint: string, encodedReceipt: string): string {
  const base = `${window.location.origin}/verify/${encodeURIComponent(fingerprint)}`;
  return `${base}?receipt=${encodeURIComponent(encodedReceipt)}`;
}
