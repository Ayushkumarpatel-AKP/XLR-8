/**
 * Raw provider probe — prints the full chat-completions message object so you
 * can see exactly what the provider returns (no secrets shown).
 *
 *   pnpm probe-model
 */
import { loadDotEnv, loadProviderConfig } from "@agentguard/model-router";

loadDotEnv();

async function main(): Promise<void> {
  const cfg = loadProviderConfig();
  if (!cfg.groqApiKey) {
    console.log("No tool-capable model provider is configured. Set GROQ_API_KEY, or add one on the Providers page.");
    return;
  }
  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${cfg.groqApiKey}` },
    body: JSON.stringify({
      model: cfg.groqModel ?? "openai/gpt-oss-120b",
      messages: [
        { role: "system", content: "You are a connectivity probe." },
        { role: "user", content: "Reply with the single word: ready" },
      ],
      temperature: 0,
      max_tokens: 256,
    }),
  });
  console.log(`HTTP ${res.status}`);
  const json = (await res.json()) as Record<string, unknown>;
  console.log(JSON.stringify(json, null, 2).slice(0, 1800));
}

main().catch((e) => {
  console.error((e as Error).message);
  process.exitCode = 1;
});
