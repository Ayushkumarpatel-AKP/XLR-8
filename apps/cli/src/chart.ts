import { ansi } from "./theme.js";

/* ------------------------------------------------------------------ *
 * Terminal chart primitives.
 *
 * Everything is visible-length aware, so coloured cells still line up.
 * ------------------------------------------------------------------ */

export type Color = (s: string) => string;

const ANSI = /\x1b\[[0-9;]*m/g;
export const visible = (s: string): number => s.replace(ANSI, "").length;

export function justify(text: string, width: number, align: "l" | "r" | "c" = "l"): string {
  const gap = Math.max(0, width - visible(text));
  if (align === "r") return " ".repeat(gap) + text;
  if (align === "c") {
    const left = Math.floor(gap / 2);
    return " ".repeat(left) + text + " ".repeat(gap - left);
  }
  return text + " ".repeat(gap);
}

/** A single filled/empty bar. */
export function bar(value: number, max: number, width = 22, color: Color = ansi.orange): string {
  const ratio = max <= 0 ? 0 : Math.max(0, Math.min(1, value / max));
  const filled = Math.round(ratio * width);
  return color("█".repeat(filled)) + ansi.olive("░".repeat(Math.max(0, width - filled)));
}

/** Labeled horizontal bar chart. */
export function barChart(
  rows: Array<{ label: string; value: number; color?: Color; suffix?: string }>,
  opts: { width?: number; labelWidth?: number; max?: number } = {},
): string[] {
  if (rows.length === 0) return [ansi.gray("  (nothing to chart)")];
  const labelWidth = opts.labelWidth ?? Math.max(...rows.map((r) => visible(r.label)), 8);
  const width = opts.width ?? 20;
  const max = opts.max ?? Math.max(...rows.map((r) => r.value), 1);
  return rows.map(
    (r) =>
      `  ${justify(r.label, labelWidth)}  ${bar(r.value, max, width, r.color ?? ansi.orange)} ${justify(String(r.value), 4, "r")}` +
      (r.suffix ? `  ${ansi.gray(r.suffix)}` : ""),
  );
}

/** One stacked bar split by category, with a legend. */
export function stackedBar(
  parts: Array<{ label: string; value: number; color: Color }>,
  width = 46,
): { bar: string; legend: string } {
  const total = parts.reduce((s, p) => s + p.value, 0);
  if (total === 0) return { bar: ansi.olive("░".repeat(width)), legend: ansi.gray("nothing to show") };

  let out = "";
  let used = 0;
  const shown = parts.filter((p) => p.value > 0);
  shown.forEach((p, i) => {
    const w = i === shown.length - 1 ? width - used : Math.round((p.value / total) * width);
    used += w;
    out += p.color("█".repeat(Math.max(0, w)));
  });
  const legend = shown.map((p) => `${p.color("■")} ${p.label} ${ansi.bold(String(p.value))}`).join("   ");
  return { bar: out, legend };
}

/** before → after with a bar for `after` and a delta arrow. */
export function compareRow(
  label: string,
  before: number,
  after: number,
  opts: { width?: number; labelWidth?: number; suffix?: string } = {},
): string {
  const labelWidth = opts.labelWidth ?? 20;
  const width = opts.width ?? 14;
  const max = Math.max(before, after, 1);
  const delta = after - before;
  const tone = delta > 0 ? ansi.red : delta < 0 ? ansi.green : ansi.gray;
  const arrow =
    delta > 0 ? ansi.red(`▲ +${delta}`) : delta < 0 ? ansi.green(`▼ ${delta}`) : ansi.gray("· no change");
  const nums = `${ansi.gray(justify(String(before), 4, "r"))} ${ansi.gray("→")} ${ansi.bold(justify(String(after), 4, "r"))}`;
  return `  ${justify(label, labelWidth)} ${nums}  ${bar(after, max, width, tone)}  ${arrow}${
    opts.suffix ? ansi.gray(`  ${opts.suffix}`) : ""
  }`;
}

/** A risk gauge: score/100 with band colouring. */
export function riskGauge(score: number, width = 40): string {
  const band = score >= 80 ? "critical" : score >= 60 ? "high" : score >= 35 ? "medium" : "low";
  const color =
    band === "critical" ? ansi.red : band === "high" ? ansi.orange : band === "medium" ? ansi.yellow : ansi.green;
  return `${bar(score, 100, width, color)} ${ansi.bold(String(score))}${ansi.gray("/100")} ${color(band.toUpperCase())}`;
}

/** Aligned table with ANSI-aware widths. */
export function table(
  headers: string[],
  rows: string[][],
  align: Array<"l" | "r" | "c"> = [],
): string[] {
  const widths = headers.map((h, i) =>
    Math.max(visible(h), ...rows.map((r) => visible(r[i] ?? "")), 1),
  );
  const line = (cells: string[], bold = false) =>
    "  " +
    cells
      .map((c, i) => {
        const cell = justify(c, widths[i] ?? 0, align[i] ?? "l");
        return bold ? ansi.bold(cell) : cell;
      })
      .join("  ")
      .replace(/\s+$/, "");

  return [
    line(headers, true),
    "  " + ansi.olive("─".repeat(widths.reduce((s, w) => s + w, 0) + (headers.length - 1) * 2)),
    ...rows.map((r) => line(r)),
  ];
}

/** Small coloured key/value chips. */
export function chips(items: Array<{ text: string; color?: Color }>): string {
  return items.map((c) => (c.color ?? ansi.gray)(`[${c.text}]`)).join(" ");
}

/** A section heading. */
export function heading(text: string): string {
  return ansi.bold(ansi.cream(text.toUpperCase()));
}

/** A 5-star scorecard row, e.g. `★★☆☆☆ 2/5`. */
export function stars(rating: number, max = 5): string {
  const clamped = Math.max(0, Math.min(max, rating));
  const full = Math.floor(clamped);
  const half = clamped - full >= 0.5;
  let out = "";
  for (let i = 0; i < max; i++) {
    if (i < full) out += ansi.yellow("★");
    else if (i === full && half) out += ansi.gray("★");
    else out += ansi.olive("☆");
  }
  const tone = clamped <= 2 ? ansi.red : clamped >= 4.5 ? ansi.green : ansi.yellow;
  return `${out} ${tone(ansi.bold(`${clamped}/${max}`))}`;
}

/**
 * A confidence bound shown the way it must be shown: with its scope and its
 * trial count, never as a bare percentage.
 */
export function bound(value: number, trials: number, scope: string): string {
  const pct = value * 100;
  const color = pct >= 80 ? ansi.red : pct >= 40 ? ansi.yellow : ansi.green;
  return `${bar(pct, 100, 16, color)} ${color(ansi.bold(`${pct.toFixed(1)}%`))} ${ansi.gray(
    `upper 95% · ${trials} trial${trials === 1 ? "" : "s"}`,
  )}\n    ${ansi.gray(scope)}`;
}

/** One-line severity pill used by the findings and disclosure rows. */
export function pill(text: string, color: Color): string {
  return color(`[${text}]`);
}

/** before — after comparison block used by drift / compare. */
export function comparison(
  left: { title: string; lines: string[] },
  right: { title: string; lines: string[] },
  width = 30,
): string[] {
  const height = Math.max(left.lines.length, right.lines.length);
  const out: string[] = [];
  out.push(`  ${ansi.bold(left.title.padEnd(width))} ${ansi.gray("│")} ${ansi.bold(right.title)}`);
  out.push(`  ${ansi.olive("─".repeat(width))} ${ansi.gray("│")} ${ansi.olive("─".repeat(width))}`);
  for (let i = 0; i < height; i++) {
    out.push(`  ${justify(left.lines[i] ?? "", width)} ${ansi.gray("│")} ${right.lines[i] ?? ""}`);
  }
  return out;
}
