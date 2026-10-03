/**
 * Walk every route in a headless browser and fail on the class of bug that
 * produced the `/agents` dead end and the permanent spinners on `/graph` and
 * `/blast-radius`: a screen that never resolves, or one with nothing to click.
 *
 * Run it against a deliberately EMPTY workspace — that is the state nobody tests
 * by hand, and the one where a missing empty-state guard hides the only way out.
 *
 *   pnpm audit:routes [baseUrl]
 */
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

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
const ROUTES = [
  "/dashboard",
  "/target",
  "/war-room/latest",
  "/replay/latest",
  "/agents",
  "/findings",
  "/drift",
  "/trust",
  "/receipts",
  "/threat-model",
  "/providers",
  "/reports",
  "/settings",
];

// A route that renders one of these and never resolves is a stuck screen.
const STUCK = /^\s*(loading|checking|building|comparing|enumerating|sealing)/i;

const port = 9337;
const profile = mkdtempSync(join(tmpdir(), "agx-routes-"));

const child = spawn(
  browser,
  [
    "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    "--window-size=1440,1000",
    `${BASE}/dashboard`,
  ],
  { stdio: "ignore" },
);

interface Target {
  type: string;
  url: string;
  webSocketDebuggerUrl: string;
}

async function findPage(): Promise<Target | null> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/json`);
    const list = (await res.json()) as Target[];
    return list.find((t) => t.type === "page" && t.url.startsWith("http")) ?? null;
  } catch {
    return null;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main(): Promise<void> {
  let page: Target | null = null;
  for (let i = 0; i < 50 && !page; i++) {
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

  const evaluate = async (expression: string): Promise<unknown> => {
    const out = (await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true })) as {
      result?: { result?: { value?: unknown } };
    };
    return out.result?.result?.value;
  };

  await send("Page.enable");

  const probe = `(() => {
    const content = document.querySelector('.content');
    if (!content) return JSON.stringify({ blank: true });
    const text = (content.innerText || '').replace(/\\s+/g, ' ').trim();
    const stuck = [...content.querySelectorAll('.empty .dim, .empty')]
      .map((el) => (el.innerText || '').replace(/\\s+/g, ' ').trim())
      .filter((t) => t.length > 0 && t.length < 60);
    return JSON.stringify({
      blank: false,
      title: (document.querySelector('.topbar h1') || {}).innerText || '',
      length: text.length,
      head: text.slice(0, 70),
      stuck,
      actions: content.querySelectorAll('a[href], button').length,
      importForm: !!content.querySelector('input[placeholder*="repo" i], input[placeholder*="github" i]'),
    });
  })()`;

  const findings: string[] = [];
  const rows: Array<{ route: string; status: string; note: string }> = [];

  for (const route of ROUTES) {
    await send("Page.navigate", { url: `${BASE}${route}` });
    // Poll until the screen settles: content present and no stuck label.
    let state: {
      blank?: boolean;
      title?: string;
      length?: number;
      head?: string;
      stuck?: string[];
      actions?: number;
      importForm?: boolean;
    } = {};
    for (let i = 0; i < 24; i++) {
      await sleep(400);
      const raw = await evaluate(probe);
      if (typeof raw !== "string") continue;
      state = JSON.parse(raw) as typeof state;
      const stuckNow = (state.stuck ?? []).some((t) => STUCK.test(t));
      if (!state.blank && (state.length ?? 0) > 40 && !stuckNow && i >= 3) break;
    }

    const problems: string[] = [];
    if (state.blank) problems.push("content area missing");
    else {
      const stuck = (state.stuck ?? []).filter((t) => STUCK.test(t));
      if (stuck.length) problems.push(`stuck on "${stuck[0]}"`);
      if ((state.length ?? 0) < 40) problems.push("content is empty");
      if ((state.actions ?? 0) === 0) problems.push("no link or button (dead end)");
    }

    const status = problems.length ? "FAIL" : "ok";
    rows.push({ route, status, note: problems.length ? problems.join("; ") : `${state.title} — ${state.head}` });
    if (problems.length) findings.push(`${route}: ${problems.join("; ")}`);

    if (route === "/agents" && !state.importForm) {
      findings.push("/agents: the import form is not on screen (this is the dead end)");
      const row = rows[rows.length - 1];
      if (row) {
        row.status = "FAIL";
        row.note += " | import form missing";
      }
    }
  }

  const pad = Math.max(...rows.map((r) => r.route.length));
  for (const r of rows) console.log(`${r.status.padEnd(4)}  ${r.route.padEnd(pad)}  ${r.note}`);

  console.log("");
  if (findings.length === 0) {
    console.log(`✓ All ${ROUTES.length} routes resolve and offer a next action.`);
  } else {
    console.log(`✗ ${findings.length} route(s) failed:`);
    for (const f of findings) console.log(`   - ${f}`);
    process.exitCode = 1;
  }

  ws.close();
}

main()
  .catch((err) => {
    console.error((err as Error).message);
    process.exitCode = 1;
  })
  .finally(() => {
    child.kill();
  });
