import { describe, expect, it } from "vitest";
import { bannerWidth, renderBanner } from "../apps/cli/src/banner.js";

describe("entry banner", () => {
  it("renders a full wordmark on wide terminals", () => {
    const lines = renderBanner(120);
    expect(lines).toHaveLength(5);
    expect(lines.every((l) => l.kind === "accent")).toBe(true);
    expect(lines[0]?.text).toContain("█");
    // full "AGENTGUARD X" is the widest variant
    expect(bannerWidth("AGENTGUARD X")).toBeGreaterThan(bannerWidth("AGENTGUARD"));
  });

  it("drops the X on medium terminals", () => {
    const lines = renderBanner(84);
    expect(lines).toHaveLength(5);
    const width = Math.max(...lines.map((l) => l.text.length));
    expect(width).toBeLessThanOrEqual(84);
    expect(width).toBeLessThan(bannerWidth("AGENTGUARD X"));
  });

  it("falls back to a compact brand on narrow terminals", () => {
    const lines = renderBanner(40);
    expect(lines).toHaveLength(1);
    expect(lines[0]?.text).toContain("A G E N T G U A R D");
  });
});
