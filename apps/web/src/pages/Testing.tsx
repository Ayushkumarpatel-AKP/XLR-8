import { useNavigate } from "react-router-dom";
import { api, useApi } from "../lib/api.js";
import { Badge, Card, Empty, ErrorBox, Loading, PageHeader, SeverityBadge } from "../components/ui.js";
import { ScenarioLauncher } from "./Dashboard.js";

export function TestingPage() {
  const navigate = useNavigate();
  const missions = useApi(() => api.missions(), []);
  const withTests = (missions.data ?? []).filter((m) => m.tests.length > 0);

  return (
    <div className="col">
      <PageHeader
        title="Attack Scenarios"
        sub="Controlled security stress tests. Every run happens in the local sandbox — no external targets, no real actions."
      />

      <Card title="Run a Scenario" sub="pick a scenario to launch a live mission">
        <ScenarioLauncher onDone={(id) => navigate(`/war-room/${id}`)} />
      </Card>

      <Card title="Test Results" sub="deterministic grading from the stress agent">
        {missions.error && <ErrorBox error={missions.error} />}
        {missions.loading ? (
          <Loading />
        ) : withTests.length === 0 ? (
          <Empty>No test runs yet.</Empty>
        ) : (
          <table className="table">
            <thead>
              <tr><th>Scenario</th><th>Status</th><th>Severity</th><th>Tools</th><th>Duration</th><th>Model</th><th></th></tr>
            </thead>
            <tbody>
              {withTests.map((m) => {
                const t = m.tests[0];
                return (
                  <tr key={m.id}>
                    <td>{t.title}</td>
                    <td><Badge tone={t.status === "PASS" ? "ok" : t.status === "WARN" ? "medium" : "critical"}>{t.status}</Badge></td>
                    <td><SeverityBadge severity={t.severity} /></td>
                    <td className="mono tiny">{t.toolRequests.join(", ")}</td>
                    <td>{t.durationMs}ms</td>
                    <td className="mono tiny">{t.model}</td>
                    <td className="right">
                      <button className="btn sm" onClick={() => navigate(`/war-room/${m.id}`)}>War Room</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
