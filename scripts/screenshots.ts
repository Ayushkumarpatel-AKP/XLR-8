/**
 * Capture the README's screenshots from a live workspace.
 *
 *   pnpm screenshots [baseUrl]        # default http://127.0.0.1:5173
 *
 * Every image is a real render of the running app against whatever the workspace
 * actually holds — no mock-ups. Run it with a mission already recorded and a
 * receipt already sealed, or the War Room and Receipts shots have nothing to
 * show.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateRawSync } from "node:zlib";

const CANDIDATES = [
  process.env.EDGE_PATH,
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
].filter(Boolean) as string[];

const browser = CANDIDATES.find((p) => existsSync(p));
if (!browser) {
  console.error("No Chromium-based browser found. Set EDGE_PATH.");
  process.exit(1);
}

const BASE = (process.argv[2] ?? "http://127.0.0.1:5173").replace(/\/$/, "");
const API = process.env.AGENTGUARD_API ?? "http://127.0.0.1:8787/api";
const OUT = "docs/screenshots";

const WIDTH = 1440;
const HEIGHT = 1000;
const PORT = 9338;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Route {
  file: string;
  path: string;
  /** Wait longer for a page that fills in from a run or a stream. */
  settleMs?: number;
}

const ROUTES: Route[] = [
  { file: "01-dashboard", path: "/dashboard" },
  { file: "02-war-room", path: "/war-room/latest", settleMs: 2500 },
  { file: "03-agent-under-test", path: "/target" },
  { file: "04-agents", path: "/agents" },
  { file: "05-findings", path: "/findings" },
  { file: "06-permission-drift", path: "/drift" },
  { file: "07-trust", path: "/trust" },
  { file: "08-receipts", path: "/receipts" },
  { file: "10-replay", path: "/replay/latest" },
  { file: "11-threat-model", path: "/threat-model" },
  { file: "12-reports", path: "/reports" },
  { file: "13-providers", path: "/providers" },
  { file: "14-settings", path: "/settings" },
];

/**
 * Rebuild the shareable verify link from a stored receipt, the way the server
 * does when it hands one over: raw DEFLATE, base64url.
 */
async function verifyUrl(): Promise<string | null> {
  try {
    const receipts = (await (await fetch(`${API}/receipts`)).json()) as Array<Record<string, unknown>>;
    const receipt = receipts[0];
    if (!receipt) return null;
    const encoded = deflateRawSync(Buffer.from(JSON.stringify(receipt), "utf8")).toString("base64url");
    return `${BASE}/verify/${encodeURIComponent(String(receipt.fingerprint))}?receipt=${encodeURIComponent(encoded)}`;
  } catch {
    return null;
  }
}

interface Target {
  type: string;
  url: string;
  webSocketDebuggerUrl: string;
}

const profile = mkdtempSync(join(tmpdir(), "agx-shots-"));
const child = spawn(
  browser,
  [
    "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    `--window-size=${WIDTH},${HEIGHT}`,
    `${BASE}/dashboard`,
  ],
  { stdio: "ignore" },
);

async function findPage(): Promise<Target | null> {
  try {
    const list = (await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()) as Target[];
    return list.find((t) => t.type === "page" && t.url.startsWith("http")) ?? null;
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  let page: Target | null = null;
  for (let i = 0; i < 60 && !page; i++) {
    page = await findPage();
    if (!page) await sleep(300);
  }
  if (!page) throw new Error("no page target appeared");

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise<void>((resolve, reject) => {
    ws.onopen = () => resolve();
    ws.onerror = () => reject(new Error("websocket failed"));
  });

  let seq = 0;
  const send = (method: string, params?: unknown): Promise<{ result?: unknown }> =>
    new Promise((resolve) => {
      const id = ++seq;
      const onMessage = (ev: MessageEvent) => {
        const msg = JSON.parse(String(ev.data)) as { id?: number };
        if (msg.id === id) {
          ws.removeEventListener("message", onMessage);
          resolve(msg as { result?: unknown });
        }
      };
      ws.addEventListener("message", onMessage);
      ws.send(JSON.stringify({ id, method, params }));
    });

  await send("Page.enable");
  await send("Emulation.setDeviceMetricsOverride", {
    width: WIDTH,
    height: HEIGHT,
    deviceScaleFactor: 2,
    mobile: false,
  });

  mkdirSync(OUT, { recursive: true });

  const capture = async (path: string, file: string, settleMs = 1400): Promise<void> => {
    await send("Page.navigate", { url: `${BASE}${path}` });
    await sleep(settleMs);
    const shot = (await send("Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: true,
    })) as { result?: { data?: string } };
    const data = shot.result?.data;
    if (!data) {
      console.error(`  ${file}: no image returned`);
      process.exitCode = 1;
      return;
    }
    const bytes = Buffer.from(data, "base64");
    writeFileSync(join(OUT, `${file}.png`), bytes);
    console.log(`  ${file}.png  ${(bytes.length / 1024).toFixed(0)} KB  ${path}`);
  };

  console.log(`capturing from ${BASE}`);
  for (const route of ROUTES) await capture(route.path, route.file, route.settleMs);

  // The verify page needs a receipt's transport form, which only the page itself
  // holds after issuing one — so build the same link the server would.
  const url = await verifyUrl();
  if (url) {
    await capture(url.slice(BASE.length), "09-verify", 1800);
  } else {
    console.log("  (no receipt in the workspace — skipping 09-verify)");
  }

  ws.close();
  child.kill();
  console.log("done");
}

void main().catch((err) => {
  console.error(String(err));
  child.kill();
  process.exit(1);
});

// Kept so an accidental import of this file does not leave a browser running.
process.on("exit", () => child.kill());
