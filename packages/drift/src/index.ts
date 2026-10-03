import {
  type AgentSnapshot,
  type DriftChange,
  type DriftEvent,
  type PermissionScope,
  newId,
  nowIso,
} from "@agentguard/contracts";

const DATA_CLASS_RANK: Record<string, number> = {
  public: 0,
  internal: 1,
  confidential: 2,
  financial: 3,
  pii: 4,
  secret: 5,
};

const CHANGE_WEIGHT: Record<DriftChange["kind"], number> = {
  tool_added: 8,
  tool_removed: -2,
  permission_added: 6,
  permission_removed: -3,
  external_destination_added: 10,
  scope_widened: 7,
  scope_narrowed: -3,
  approval_removed: 12,
  sensitive_data_access_added: 9,
  trust_added: 5,
};

const SENSITIVE = new Set(["pii", "financial", "secret", "confidential"]);

function scopeKey(s: PermissionScope): string {
  return `${s.resource}:${s.action}`;
}

/**
 * Compare two snapshots and emit a deterministic DriftEvent. No hardcoded
 * version strings — every change is derived from the snapshot contents.
 */
export function compareSnapshots(from: AgentSnapshot, to: AgentSnapshot): DriftEvent {
  const changes: DriftChange[] = [];

  const fromTools = new Set(from.toolNames);
  const toTools = new Set(to.toolNames);
  for (const t of toTools) {
    if (!fromTools.has(t)) {
      changes.push({
        kind: "tool_added",
        subject: t,
        detail: `Tool "${t}" added to agent capabilities.`,
        riskDelta: CHANGE_WEIGHT.tool_added,
      });
    }
  }
  for (const t of fromTools) {
    if (!toTools.has(t)) {
      changes.push({
        kind: "tool_removed",
        subject: t,
        detail: `Tool "${t}" removed from agent capabilities.`,
        riskDelta: CHANGE_WEIGHT.tool_removed,
      });
    }
  }

  const fromScopes = new Map(from.scopes.map((s) => [scopeKey(s), s]));
  const toScopes = new Map(to.scopes.map((s) => [scopeKey(s), s]));
  for (const [k, s] of toScopes) {
    const prev = fromScopes.get(k);
    if (!prev) {
      changes.push({
        kind: "permission_added",
        subject: k,
        detail: `New permission "${k}" (${s.dataClass}).`,
        riskDelta: CHANGE_WEIGHT.permission_added,
      });
      if (SENSITIVE.has(s.dataClass)) {
        changes.push({
          kind: "sensitive_data_access_added",
          subject: k,
          detail: `New ${s.dataClass}-class data access via "${k}".`,
          riskDelta: CHANGE_WEIGHT.sensitive_data_access_added,
        });
      }
    } else {
      const prevRank = DATA_CLASS_RANK[prev.dataClass] ?? 0;
      const nextRank = DATA_CLASS_RANK[s.dataClass] ?? 0;
      if (nextRank > prevRank) {
        changes.push({
          kind: "scope_widened",
          subject: k,
          detail: `Scope "${k}" widened from ${prev.dataClass} to ${s.dataClass}.`,
          riskDelta: CHANGE_WEIGHT.scope_widened,
        });
      } else if (nextRank < prevRank) {
        changes.push({
          kind: "scope_narrowed",
          subject: k,
          detail: `Scope "${k}" narrowed from ${prev.dataClass} to ${s.dataClass}.`,
          riskDelta: CHANGE_WEIGHT.scope_narrowed,
        });
      }
      if (prev.approvalRequired && !s.approvalRequired) {
        changes.push({
          kind: "approval_removed",
          subject: k,
          detail: `Approval gate removed from "${k}".`,
          riskDelta: CHANGE_WEIGHT.approval_removed,
        });
      }
    }
  }
  for (const [k, s] of fromScopes) {
    if (!toScopes.has(k)) {
      changes.push({
        kind: "permission_removed",
        subject: k,
        detail: `Permission "${k}" (${s.dataClass}) removed.`,
        riskDelta: CHANGE_WEIGHT.permission_removed,
      });
    }
  }

  const fromExt = new Set(from.externalDestinations);
  for (const d of to.externalDestinations) {
    if (!fromExt.has(d)) {
      changes.push({
        kind: "external_destination_added",
        subject: d,
        detail: `New external destination reachable via "${d}".`,
        riskDelta: CHANGE_WEIGHT.external_destination_added,
      });
      changes.push({
        kind: "trust_added",
        subject: d,
        detail: `New outbound trust boundary to "${d}".`,
        riskDelta: CHANGE_WEIGHT.trust_added,
      });
    }
  }

  const riskDelta = changes.reduce((sum, c) => sum + c.riskDelta, 0);
  const newAttackSurface = [...new Set(changes.filter((c) => c.riskDelta > 0).map((c) => c.kind))];

  return {
    id: newId("drift"),
    agentId: to.agentId,
    fromSnapshotId: from.id,
    toSnapshotId: to.id,
    createdAt: nowIso(),
    changes,
    changedCapabilityCount: changes.length,
    riskDelta,
    newAttackSurface,
    summary:
      changes.length === 0
        ? "No posture change detected between snapshots."
        : `${changes.filter((c) => c.riskDelta > 0).length} posture-increasing change(s); risk delta ${riskDelta >= 0 ? "+" : ""}${riskDelta}.`,
  };
}
