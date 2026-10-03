import { useState } from "react";
import type { ToolDefinition } from "@agentguard/contracts";
import { api, useApi } from "../lib/api.js";
import { Badge, Card, Empty, ErrorBox, Loading, PageHeader } from "../components/ui.js";

export function ToolsPage() {
  const tools = useApi(() => api.tools(), []);
  const [filter, setFilter] = useState("");
  const [edge, setEdge] = useState<string>("all");

  if (tools.error) return <ErrorBox error={tools.error} />;
  if (tools.loading) return <Loading label="Loading tools…" />;
  const all = tools.data ?? [];
  const edges = ["all", ...new Set(all.map((t) => t.edge))];

  const filtered = all.filter(
    (t) => (edge === "all" || t.edge === edge) && (filter === "" || t.name.toLowerCase().includes(filter.toLowerCase())),
  );

  return (
    <div className="col">
      <PageHeader title="Tool Monitoring" sub="Every capability an agent can invoke, with its real data classes and side effects." />

      <Card
        title="Filters"
        right={
          <div className="row">
            <input className="input" placeholder="Search tools…" value={filter} onChange={(e) => setFilter(e.target.value)} />
          </div>
        }
      >
        <div className="row" style={{ flexWrap: "wrap", gap: 6 }}>
          {edges.map((e) => (
            <span key={e} className={`filter-chip${edge === e ? " active" : ""}`} onClick={() => setEdge(e)}>{e}</span>
          ))}
        </div>
      </Card>

      <Card title={`Tools (${filtered.length})`}>
        {filtered.length === 0 ? (
          <Empty>No tools match the current filter.</Empty>
        ) : (
          <table className="table">
            <thead>
              <tr><th>Tool</th><th>Edge</th><th>Side effect</th><th>Data classes</th><th>Targets</th><th>Flags</th></tr>
            </thead>
            <tbody>
              {filtered.map((t) => <ToolRow key={t.id} t={t} />)}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}

function ToolRow({ t }: { t: ToolDefinition }) {
  return (
    <tr>
      <td>
        <div className="mono">{t.name}</div>
        <div className="tiny faint truncate" style={{ maxWidth: 320 }}>{t.description}</div>
      </td>
      <td className="tiny">{t.edge}</td>
      <td className="tiny dim">{t.sideEffect}</td>
      <td className="tiny dim">{t.dataClasses.join(", ") || "—"}</td>
      <td className="tiny dim">{t.targets.map((x) => x.label).join(", ") || "—"}</td>
      <td>
        <span className="row" style={{ gap: 4 }}>
          {t.external && <Badge tone="high">external</Badge>}
          {t.approvalRequired && <Badge tone="medium">approval</Badge>}
          {t.mcpServer && <Badge tone="low">{t.mcpServer}</Badge>}
        </span>
      </td>
    </tr>
  );
}
