/** Shared terminal UI primitives for the CLI (used by the TUI and the chat layer). */

export type Kind = "info" | "ok" | "warn" | "err" | "dim" | "accent" | "title";

export interface Line {
  text: string;
  kind: Kind;
  /**
   * Pre-coloured content (e.g. a rendered graph). Raw lines are emitted
   * verbatim and never wrapped or re-coloured.
   */
  raw?: boolean;
}

/** 256-colour codes matching the AgentGuard palette. */
export const KIND_CODE: Record<Kind, string> = {
  info: "38;5;230", // cream
  ok: "38;5;72", // green
  warn: "38;5;179", // amber
  err: "38;5;167", // red
  dim: "38;5;245", // grey
  accent: "38;5;208", // orange
  title: "1;38;5;208",
};

export const RESET = "\x1b[0m";

export function colourLine(line: Line): string {
  if (line.raw) return line.text;
  return `\x1b[${KIND_CODE[line.kind]}m${line.text}${RESET}`;
}

export function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*m/g, "");
}

export function visibleLength(s: string): number {
  return stripAnsi(s).length;
}

/** Pad or truncate to an exact visible width. */
export function fit(text: string, width: number): string {
  const t = visibleLength(text) > width ? stripAnsi(text).slice(0, width) : text;
  return t + " ".repeat(Math.max(0, width - visibleLength(t)));
}

/** Wrap plain text to a width, preserving explicit newlines. */
export function wrap(text: string, width: number): string[] {
  if (width <= 0) return [text];
  const out: string[] = [];
  for (const raw of text.split("\n")) {
    if (raw.length <= width) {
      out.push(raw);
      continue;
    }
    let rest = raw;
    while (rest.length > width) {
      let cut = rest.lastIndexOf(" ", width);
      if (cut <= 0) cut = width;
      out.push(rest.slice(0, cut));
      rest = rest.slice(cut).trimStart();
    }
    out.push(rest);
  }
  return out;
}
