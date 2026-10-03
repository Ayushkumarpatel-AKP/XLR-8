/**
 * Run the AgentGuard X backend and web app together.
 *
 *   pnpm dev
 *
 * API  → http://127.0.0.1:8787   (REST + SSE)
 * Web  → http://127.0.0.1:5173   (Vite dev server, proxies /api)
 */
import { spawn, type ChildProcess } from "node:child_process";

const isWindows = process.platform === "win32";
const children: ChildProcess[] = [];

function run(name: string, command: string, args: string[], env: NodeJS.ProcessEnv): void {
  const child = spawn(command, args, {
    stdio: "inherit",
    shell: isWindows,
    env: { ...process.env, ...env },
  });
  child.on("exit", (code, signal) => {
    if (signal) return;
    console.log(`[dev] ${name} exited with code ${code}`);
  });
  children.push(child);
}

console.log("[dev] starting AgentGuard X — DEMO / SANDBOX / NO REAL DATA");
console.log("[dev] API → http://127.0.0.1:8787");
console.log("[dev] Web → http://127.0.0.1:5173");

run("api", "npx", ["tsx", "services/api/src/server.ts"], {
  PORT: process.env.PORT ?? "8787",
  NODE_ENV: process.env.NODE_ENV ?? "development",
});

run(
  "web",
  "pnpm",
  ["--filter", "@agentguard/web", "exec", "vite", "--port", "5173", "--host", "127.0.0.1"],
  { NODE_ENV: process.env.NODE_ENV ?? "development" },
);

function shutdown(): void {
  for (const child of children) {
    if (!child.killed) child.kill();
  }
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
