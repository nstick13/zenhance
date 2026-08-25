# Reference artifacts

Third-party or historical artifacts kept for reference. **Not source, not built, not routed** —
this directory sits outside `app/`, so nothing here is served by Next.

## `greg-preview-v1.html`

Greg's Zenhance prototype, shared 2026-08-25. It is what triggered the v2 direction — read
[../V2.md](../V2.md) for the decisions that came out of it.

- **What it is:** a self-contained Vite production build — React 18 + **Konva** (canvas), minified
  into a single 493KB HTML file. A build artifact, not the source; Greg has that.
- **How to view it:** open the file directly in a browser (`file://`). No server, no deps.
- **Checksum:** `sha256 e74a55ed…d3d8034` — the file exactly as shared, unmodified.

### What it demonstrates

| | |
|---|---|
| Renderer | Canvas via Konva (vs. our shipped SVG + D3) |
| Layout | Free-form `x`/`y` — placement is data, not layout output |
| Semantic zoom | Four rungs at scale 0.26 / 0.45 / 1.5 — Functions → Teams → People → Tasks |
| Editing | Inline callout on the map: name, role, utilization %, status, team, budget |
| Authoring | Place Person/Team/Project, draw Zones, Tidy up, snap-to-grid |
| Zones | Box over a region → headcount + budget inside + an estimated delivery date |
| Layers | Reporting vs. Projects edges as independent toggles |
| What-if | "Hypothetical" mode with amber chrome and Revert |

Its data model is a flat node list (`individual` / `team` / `project` / `portfolio`) carrying its own
coordinates, with relationships as id references — the shape our `app/lab/canvas/demoMap.ts` adopts.

Note his zone readout estimates a delivery date from a flat A$25k/person/month assumption; ours prices
the same selection off real `costPerMonth` data instead.
