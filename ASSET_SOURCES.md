# Asset Sources

AgentGuard X ships **no third-party images, icons or fonts** and has no runtime
dependency on any decorative third-party site.

## Visuals

| Asset | Source | License |
| --- | --- | --- |
| `apps/web` brand mark ("A" tile) | project-created (CSS) | Apache-2.0 |
| Graph nodes / edges / risk dial | project-created (inline SVG) | Apache-2.0 |
| CLI glyphs (✓ ● ○ ✗ →) | Unicode standard characters | n/a |
| Status colours & palette | project-created design tokens | Apache-2.0 |

## Palette (design tokens only)

```
#2E2910  olive   — structure / rails
#2C5745  green   — secondary surfaces
#EBE3A7  cream   — primary text
#EB7D00  orange  — emphasis, warning, key interaction states
```

Semantic variants (`--critical`, `--high`, `--medium`, `--low`, `--ok`) are derived
in `apps/web/src/styles.css`. No orange-only theming is used.

## Policy

If a third-party SVG or icon set is added later, it must be:
1. licensed for commercial use,
2. downloaded and stored locally (no hotlinking),
3. recorded in this file with its source and license.

Recommended, license-clean sources if needed: **Lucide** (ISC) and **Simple Icons** (CC0).
