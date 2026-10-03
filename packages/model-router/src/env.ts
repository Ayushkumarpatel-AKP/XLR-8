import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Minimal, dependency-free `.env` loader.
 *
 * - never overrides variables already present in the real environment
 * - skipped entirely under test, so CI never picks up real API keys
 * - the values are never logged or exposed
 */
export function loadDotEnv(path = resolve(process.cwd(), ".env")): void {
  if (process.env.AGENTGUARD_NO_DOTENV === "1") return;
  if (process.env.NODE_ENV === "test") return;
  if (!existsSync(path)) return;

  for (const raw of readFileSync(path, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env) || process.env[key] === "") {
      process.env[key] = value;
    }
  }
}
