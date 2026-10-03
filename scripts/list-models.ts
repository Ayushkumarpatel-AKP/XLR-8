/**
 * List the models your configured provider actually exposes (no secrets shown).
 *   pnpm models
 */
import { loadProviderConfig, loadDotEnv } from "@agentguard/model-router";

loadDotEnv();

async function main(): Promise<void> {
  const cfg = loadProviderConfig();
  if (!cfg.groqApiKey) {
    console.log("GROQ_API_KEY is not set (add it to .env).");
    return;
  }
  const res = await fetch("https://api.groq.com/openai/v1/models", {
    headers: { authorization: `Bearer ${cfg.groqApiKey}` },
  });
  if (!res.ok) {
    console.error(`HTTP ${res.status}: ${await res.text()}`);
    process.exitCode = 1;
    return;
  }
  const json = (await res.json()) as { data?: Array<{ id: string; owned_by?: string }> };
  const ids = (json.data ?? []).map((m) => m.id).sort();
  console.log(`${ids.length} model(s) available on Groq:\n`);
  for (const id of ids) console.log("  " + id);
}

main().catch((e) => {
  console.error((e as Error).message);
  process.exitCode = 1;
});
