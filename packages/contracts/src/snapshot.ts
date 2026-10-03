import { type AgentManifest, type AgentSnapshot, digestSnapshot, nowIso, newId } from "@agentguard/contracts";

/** Build an immutable snapshot from a live agent manifest (used for drift). */
export function snapshotAgent(manifest: AgentManifest, label: string): AgentSnapshot {
  const toolNames = manifest.tools.map((t) => t.name).sort();
  const externalDestinations = manifest.tools
    .filter((t) => t.external)
    .map((t) => t.name)
    .sort();
  const snap: AgentSnapshot = {
    id: newId("snapshot"),
    agentId: manifest.id,
    label,
    capturedAt: nowIso(),
    toolNames,
    scopes: manifest.scopes,
    externalDestinations,
    contentDigest: "",
  };
  snap.contentDigest = digestSnapshot({
    toolNames: snap.toolNames,
    scopes: snap.scopes.map((s) => `${s.resource}:${s.action}`).sort(),
    externalDestinations: snap.externalDestinations,
  });
  return snap;
}
