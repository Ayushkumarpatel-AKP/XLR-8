export interface Prefs {
  accent: string;
  density: "comfortable" | "compact";
  motion: boolean;
}

export const ACCENTS: Array<{ id: string; label: string; color: string }> = [
  { id: "orange", label: "Ember", color: "#eb7d00" },
  { id: "cyan", label: "Signal", color: "#4fd1c5" },
  { id: "green", label: "Field", color: "#4fbf7a" },
  { id: "violet", label: "Violet", color: "#9c7adf" },
];

const KEY = "agentguard.prefs";

export const DEFAULT_PREFS: Prefs = { accent: "orange", density: "comfortable", motion: true };

export function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_PREFS };
    return { ...DEFAULT_PREFS, ...(JSON.parse(raw) as Partial<Prefs>) };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export function savePrefs(prefs: Prefs): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    /* storage disabled — preferences simply won't persist */
  }
}

export function applyPrefs(prefs: Prefs): void {
  const accent = ACCENTS.find((a) => a.id === prefs.accent) ?? ACCENTS[0]!;
  document.documentElement.style.setProperty("--orange", accent.color);
  document.body.classList.toggle("dense", prefs.density === "compact");
  document.body.classList.toggle("no-motion", !prefs.motion);
}
