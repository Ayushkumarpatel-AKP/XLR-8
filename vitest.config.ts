import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@agentguard/contracts": r("./packages/contracts/src/index.ts"),
      "@agentguard/core": r("./packages/core/src/index.ts"),
      "@agentguard/policies": r("./packages/policies/src/index.ts"),
      "@agentguard/evidence": r("./packages/evidence/src/index.ts"),
      "@agentguard/receipt": r("./packages/receipt/src/index.ts"),
      "@agentguard/receipt/shared": r("./packages/receipt/src/shared.ts"),
      "@agentguard/sarif": r("./packages/sarif/src/index.ts"),
      "@agentguard/graph": r("./packages/graph/src/index.ts"),
      "@agentguard/drift": r("./packages/drift/src/index.ts"),
      "@agentguard/mcp": r("./packages/mcp/src/index.ts"),
      "@agentguard/model-router": r("./packages/model-router/src/index.ts"),
      "@agentguard/demo-lab": r("./demo-lab/src/index.ts"),
      "@agentguard/api": r("./services/api/src/context.ts"),
    },
  },
  test: {
    include: ["packages/**/*.test.ts", "demo-lab/**/*.test.ts", "services/**/*.test.ts", "tests/**/*.test.ts"],
    environment: "node",
    // Tests must never pick up a real API key from .env — they stay hermetic.
    // NVIDIA is the primary provider, so a key exported in the operator's shell
    // sent ~30 model-backed tests to the real API, where they failed on rate
    // limits. Adding a provider means adding it here too.
    env: {
      AGENTGUARD_NO_DOTENV: "1",
      NVIDIA_API_KEY: "",
      GROQ_API_KEY: "",
      DEEPSEEK_API_KEY: "",
      HUGGINGFACE_API_KEY: "",
      OLLAMA_BASE_URL: "",
      OPENAI_COMPATIBLE_BASE_URL: "",
      OPENAI_COMPATIBLE_API_KEY: "",
    },
  },
});
