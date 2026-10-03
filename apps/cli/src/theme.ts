/**
 * Terminal theme. Uses the AgentGuard palette; degrades to plain text when the
 * output is not a TTY or NO_COLOR is set.
 */
const enabled = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;

const wrap = (open: string) => (s: string) => (enabled ? `\x1b[${open}m${s}\x1b[0m` : s);

export const ansi = {
  reset: (s: string) => s,
  bold: wrap("1"),
  dim: wrap("2"),
  italic: wrap("3"),
  underline: wrap("4"),
  // semantic palette
  orange: wrap("38;5;208"), // #EB7D00 — emphasis / warning / key state
  cream: wrap("38;5;230"), // #EBE3A7 — primary text
  olive: wrap("38;5;58"), // #2E2910 — dim structural
  green: wrap("38;5;71"), // #2C5745 family
  red: wrap("38;5;167"),
  yellow: wrap("38;5;179"),
  blue: wrap("38;5;74"),
  cyan: wrap("38;5;80"),
  gray: wrap("38;5;245"),
  magenta: wrap("38;5;170"),
};

export const severityColor = (severity: string): ((s: string) => string) => {
  switch (severity) {
    case "critical":
      return ansi.red;
    case "high":
      return ansi.orange;
    case "medium":
      return ansi.yellow;
    case "low":
      return ansi.blue;
    default:
      return ansi.gray;
  }
};

export const stateGlyph = (state: string): string => {
  switch (state) {
    case "done":
      return ansi.green("✓");
    case "running":
      return ansi.orange("●");
    case "failed":
      return ansi.red("✗");
    case "skipped":
      return ansi.gray("–");
    default:
      return ansi.gray("○");
  }
};

export function rule(width = 66): string {
  return ansi.olive("─".repeat(width));
}

/** Visible-length-aware pad (ANSI codes excluded). */
export function pad(text: string, len: number): string {
  const visible = text.replace(/\x1b\[[0-9;]*m/g, "");
  return text + " ".repeat(Math.max(0, len - visible.length));
}

export function box(title: string, lines: string[], width = 66): string {
  const inner = width - 2;
  const top = ansi.olive("┌" + "─".repeat(inner) + "┐");
  const head = ansi.olive("│") + " " + pad(ansi.bold(title), inner - 1) + ansi.olive("│");
  const bottom = ansi.olive("└" + "─".repeat(inner) + "┘");
  const body = lines.map((l) => ansi.olive("│") + " " + pad(l, inner - 1) + ansi.olive("│"));
  return [top, head, ansi.olive("├" + "─".repeat(inner) + "┤"), ...body, bottom].join("\n");
}

export function clearScreen(): void {
  if (enabled) process.stdout.write("\x1b[2J\x1b[H");
}

export const isColorEnabled = (): boolean => enabled;
