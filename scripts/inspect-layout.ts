/**
 * Measure a page's real layout in a headless browser via the Chrome DevTools
 * Protocol. Used to diagnose runaway page height / scroll issues.
 *
 *   pnpm inspect-layout [url]
 */
import { spawn } from "node:child_process";
import { mkdtempSync, existsSync, writeFileSync } from "node:fs";
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

const url = process.argv[2] ?? "http://127.0.0.1:5173/dashboard";
const port = 9333;
const profile = mkdtempSync(join(tmpdir(), "agx-inspect-"));

const child = spawn(
  browser,
  [
    "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    "--window-size=" + (process.env.WINDOW ?? "1280,900"),
    url,
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

async function main(): Promise<void> {
  let page: Target | null = null;
  for (let i = 0; i < 50 && !page; i++) {
    page = await findPage();
    if (!page) await new Promise((r) => setTimeout(r, 300));
  }
  if (!page) throw new Error("no page target appeared");

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise<void>((resolve, reject) => {
    ws.onopen = () => resolve();
    ws.onerror = () => reject(new Error("websocket failed"));
  });
  let seq = 0;
  const send = (method: string, params?: unknown): Promise<unknown> =>
    new Promise((resolve) => {
      const id = ++seq;
      const onMessage = (ev: MessageEvent) => {
        const msg = JSON.parse(String(ev.data)) as { id?: number };
        if (msg.id === id) {
          ws.removeEventListener("message", onMessage);
          resolve(msg);
        }
      };
      ws.addEventListener("message", onMessage);
      ws.send(JSON.stringify({ id, method, params }));
    });

  // Optional: run script before the app loads (e.g. to seed localStorage).
  if (process.env.INIT_JS) {
    await send("Page.enable");
    await send("Page.addScriptToEvaluateOnNewDocument", { source: process.env.INIT_JS });
    await send("Page.reload", { ignoreCache: true });
    await new Promise((r) => setTimeout(r, 4000));
  } else {
    // Let the SPA render and fetch.
    await new Promise((r) => setTimeout(r, 3000));
  }
  const expression = `(() => {
    const rect = (sel) => { const el = document.querySelector(sel); return el ? Math.round(el.getBoundingClientRect().height) : null; };
    const scroll = (sel) => { const el = document.querySelector(sel); return el ? el.scrollHeight : null; };
    const label = (el) => el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.split(' ').slice(0,2).join('.') : '');
    const all = [...document.querySelectorAll('body *')];
    const vw = window.innerWidth;
    const overflowing = all
      .map((el) => ({ el, r: el.getBoundingClientRect() }))
      .filter(({ r }) => r.width > 0 && r.right > vw + 1)
      .map(({ el, r }) => ({ t: label(el), w: Math.round(r.width), right: Math.round(r.right) }))
      .sort((a, b) => b.right - a.right).slice(0, 8);
    const innerScrollers = all
      .filter((el) => el.scrollWidth > el.clientWidth + 1 && el.clientWidth > 0)
      .map((el) => ({ t: label(el), scrollW: el.scrollWidth, clientW: el.clientWidth }))
      .slice(0, 8);
    const content = document.querySelector('.content');
    const contentBottom = content ? Math.round(content.getBoundingClientRect().bottom + window.scrollY) : 0;
    const tail = [...document.querySelectorAll('body *')]
      .map((el) => Math.round(el.getBoundingClientRect().bottom + window.scrollY))
      .filter((b) => b > 0);
    return JSON.stringify({
      url: location.pathname,
      innerHeight: window.innerHeight,
      innerWidth: vw,
      documentScrollHeight: document.documentElement.scrollHeight,
      documentScrollWidth: document.documentElement.scrollWidth,
      bodyOffsetHeight: document.body.offsetHeight,
      root: rect('#root'),
      app: rect('.app'),
      sidebar: rect('.sidebar'),
      content: rect('.content'),
      lastContentBottom: Math.max(0, ...tail),
      tailGap: document.documentElement.scrollHeight - Math.max(0, ...tail),
      contentBottom,
      tallest: all
        .map((el) => ({ t: label(el), h: Math.round(el.getBoundingClientRect().height) }))
        .sort((a, b) => b.h - a.h).slice(0, 5),
      overflowing,
      innerScrollers
    });
  })()`;

  const out = (await send("Runtime.evaluate", { expression, returnByValue: true })) as {
    result?: { result?: { value?: unknown } };
  };
  const value = out.result?.result?.value;
  console.log(typeof value === "string" ? JSON.stringify(JSON.parse(value), null, 2) : value);

  // Optional: evaluate an arbitrary expression in the page (EVAL="...").
  if (process.env.EVAL) {
    const res = (await send("Runtime.evaluate", {
      expression: process.env.EVAL,
      returnByValue: true,
      awaitPromise: true,
    })) as { result?: { result?: { value?: unknown; description?: string } } };
    console.log("eval →", JSON.stringify(res.result?.result?.value ?? res.result?.result?.description ?? null));
  }

  // Optional: read specific UI text (comma-separated CSS selectors).
  if (process.env.PROBE) {
    const selectors = process.env.PROBE.split(",").map((s) => s.trim()).filter(Boolean);
    const probeExpr = `JSON.stringify(${JSON.stringify(selectors)}.map((sel) => {
      const el = document.querySelector(sel);
      return { sel, text: el ? (el.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 120) : null };
    }))`;
    const probe = (await send("Runtime.evaluate", { expression: probeExpr, returnByValue: true })) as {
      result?: { result?: { value?: unknown } };
    };
    const raw = probe.result?.result?.value;
    if (typeof raw === "string") {
      for (const row of JSON.parse(raw) as Array<{ sel: string; text: string | null }>) {
        console.log(`probe ${row.sel} → ${row.text ?? "(missing)"}`);
      }
    }
  }

  // Optional: capture a PNG of the page (SHOT=<path>).
  if (process.env.SHOT) {
    const full = process.env.FULL !== "0";
    const shot = (await send("Page.captureScreenshot", {
      format: "png",
      ...(full ? { captureBeyondViewport: true } : {}),
    })) as {
      result?: { data?: string };
    };
    const data = shot.result?.data;
    if (data) {
      writeFileSync(process.env.SHOT, Buffer.from(data, "base64"));
      console.log(`screenshot → ${process.env.SHOT}`);
    }
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
