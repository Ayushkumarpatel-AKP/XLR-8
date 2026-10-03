import {
  type DataClass,
  type EdgeKind,
  type SideEffect,
  type ToolDefinition,
  nowIso,
} from "@agentguard/contracts";
import type { ModelRouter } from "@agentguard/model-router";

/* ------------------------------------------------------------------ *
 * Model-assisted tool classification.
 *
 * The model's ONLY job here is interpretation: reading a tool's own
 * description and proposing its security semantics. It cannot grant or deny
 * anything — the deterministic policy engine still makes every decision from
 * the resulting labels, and the provider/model is recorded as provenance.
 * ------------------------------------------------------------------ */

const EDGES: EdgeKind[] = ["READ", "WRITE", "EXECUTE", "SEND", "NETWORK", "FINANCIAL", "DEVICE_CONTROL", "TRUST"];
const SIDE_EFFECTS: SideEffect[] = ["none", "read", "write", "irreversible"];
const DATA_CLASSES: DataClass[] = ["public", "internal", "confidential", "pii", "financial", "secret"];

const CHUNK = 10;
const MAX_TOKENS = 3000;

export interface ClassificationResult {
  tools: ToolDefinition[];
  providerId: string;
  model: string;
  /** How many tools actually received a valid classification. */
  classified: number;
  notes: string[];
}

interface Proposal {
  name?: unknown;
  edge?: unknown;
  sideEffect?: unknown;
  dataClasses?: unknown;
  external?: unknown;
  approvalRequired?: unknown;
}

/**
 * Parse the model's reply into proposals. Models like to wrap JSON in prose or
 * code fences, and long lists can be truncated — so try several strategies.
 */
function parseProposals(text: string): Proposal[] | null {
  const cleaned = text.replace(/```(?:json)?/gi, "").trim();

  const attempts: string[] = [cleaned];
  const start = cleaned.indexOf("[");
  const end = cleaned.lastIndexOf("]");
  if (start !== -1 && end > start) attempts.push(cleaned.slice(start, end + 1));
  // last resort: keep every complete object inside the array
  if (start !== -1) {
    const body = cleaned.slice(start);
    const lastClose = body.lastIndexOf("}");
    if (lastClose > 0) attempts.push(body.slice(0, lastClose + 1) + "]");
  }

  for (const candidate of attempts) {
    try {
      const parsed = JSON.parse(candidate) as unknown;
      if (Array.isArray(parsed)) return parsed as Proposal[];
    } catch {
      /* try the next strategy */
    }
  }
  return null;
}

function applyProposal(tool: ToolDefinition, p: Proposal): boolean {
  let touched = false;
  if (typeof p.edge === "string" && (EDGES as string[]).includes(p.edge)) {
    tool.edge = p.edge as EdgeKind;
    touched = true;
  }
  if (typeof p.sideEffect === "string" && (SIDE_EFFECTS as string[]).includes(p.sideEffect)) {
    tool.sideEffect = p.sideEffect as SideEffect;
    touched = true;
  }
  if (Array.isArray(p.dataClasses)) {
    const classes = p.dataClasses.filter((d): d is DataClass => typeof d === "string" && (DATA_CLASSES as string[]).includes(d));
    if (classes.length > 0) {
      tool.dataClasses = classes;
      touched = true;
    }
  }
  if (typeof p.external === "boolean") {
    tool.external = p.external;
    touched = true;
  }
  if (typeof p.approvalRequired === "boolean") {
    tool.approvalRequired = p.approvalRequired;
    touched = true;
  }
  return touched;
}

/**
 * Ask the model to label each tool's semantics from its own description.
 * Returns new tool objects; the originals are left untouched.
 */
export async function classifyTools(router: ModelRouter, tools: ToolDefinition[]): Promise<ClassificationResult> {
  const notes: string[] = [];
  const out = tools.map((t) => ({ ...t, dataClasses: [...t.dataClasses], targets: [...t.targets], scopes: [...t.scopes] }));
  if (!router.hasRealProvider()) {
    notes.push("no real model provider configured — tools left with their declared semantics");
    return { tools: out, providerId: "none", model: "none", classified: 0, notes };
  }

  const byName = new Map(out.map((t) => [t.name, t]));
  let providerId = "unknown";
  let model = "unknown";
  let classified = 0;

  for (let i = 0; i < out.length; i += CHUNK) {
    const slice = out.slice(i, i + CHUNK);
    const payload = slice.map((t) => ({ name: t.name, description: t.description.slice(0, 160) }));
    try {
      const res = await router.generate({
        system: [
          "You classify API operations for a security audit. For each operation, infer its security semantics from its description.",
          `edge: one of ${EDGES.join(", ")} (use FINANCIAL for money movement, DEVICE_CONTROL for physical devices).`,
          `sideEffect: one of ${SIDE_EFFECTS.join(", ")}.`,
          `dataClasses: subset of ${DATA_CLASSES.join(", ")} (use pii for personal data, financial for money/balances).`,
          "external: true when the operation leaves the trust boundary.",
          "approvalRequired: true when a human should approve it (money movement, irreversible, sensitive data).",
          'Reply with ONLY a compact JSON array, no prose, no code fences:',
          '[{"name":"...","edge":"...","sideEffect":"...","dataClasses":["..."],"external":true,"approvalRequired":false}]',
        ].join("\n"),
        prompt: JSON.stringify(payload),
        temperature: 0,
        maxTokens: MAX_TOKENS,
      });
      if (res.providerKind !== "deterministic") providerId = res.providerId;
      if (res.providerKind === "deterministic") {
        notes.push("model unavailable — the deterministic fallback cannot classify; semantics left as declared");
        break;
      }
      const proposals = parseProposals(res.text);
      if (!proposals) {
        notes.push(`chunk ${i / CHUNK + 1}: model reply was not a JSON array — skipped`);
        continue;
      }
      for (const p of proposals) {
        if (typeof p.name !== "string") continue;
        const tool = byName.get(p.name);
        if (tool && applyProposal(tool, p)) classified++;
      }
    } catch (err) {
      notes.push(`chunk ${i / CHUNK + 1} failed: ${(err as Error).message}`);
    }
  }

  notes.push(`classified ${classified}/${out.length} tool(s) at ${nowIso()}`);
  return { tools: out, providerId, model, classified, notes };
}
