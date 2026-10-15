/**
 * `npm run hex:confetti` — the confetti repro on Northwind, the company it was
 * reported on.
 *
 * The regression test lives in `app/lab/hex/confetti.test.ts` and runs on the
 * 1,000-person company so the suite stays usable. This is the full-size
 * version: 2,957 units, the branch Greg actually grabbed (Everest Region,
 * 1,258 units — exactly the move count his saved arrangement held), and a drop
 * aimed to overlap rather than into open ground.
 *
 * It prints the two ways `placeIsland` can be called, because that is the
 * decision a draft rule set got wrong: it proposed deleting `groupOf` *and*
 * `gapBetween`, and only one of those was right. `gapBetween` has since gone
 * with the archipelago; `groupOf` is the half holding the branch together, and
 * this is what says so. See `docs/MAP-LAWS.md`.
 */
import { buildLabCompany } from "@/app/lab/hex/company";
import { buildOrbitalTree, type OrbitalTree } from "@/lib/map/layout/model";
import { layoutTerritories } from "@/lib/map/layout/hex/territory";
import { branchOf, placeIsland } from "@/lib/map/layout/hex/arrange";
import { cellKey, hexDistance, neighbours, type Cell } from "@/lib/map/layout/hex/coords";
import { neaten } from "@/lib/map/layout/hex/tidy";
import { hexSizeFor } from "@/lib/map/layout/hex/scene";

const EVEREST = "e56cb367-e560-4e56-8e68-e6832df4e480";

function measure(tree: OrbitalTree, cells: ReadonlyMap<string, Cell>, scope?: Set<string>) {
  const occ = new Map<string, string>(); let buried = 0;
  for (const [id, c] of cells) { const k = cellKey(c); if (occ.has(k)) buried++; else occ.set(k, id); }
  const centre = cells.get(tree.rootId)!;
  let children = 0, touching = 0, families = 0, whole = 0, curled = 0, worst = 0;
  for (const u of tree.units.values()) {
    if (scope && !scope.has(u.id)) continue;
    const own = cells.get(u.id); if (!own) continue;
    if (u.parentId) {
      children++;
      const parent = cells.get(u.parentId);
      const kin = new Set<string>();
      if (parent) kin.add(cellKey(parent));
      for (const s of tree.units.get(u.parentId)?.childIds ?? []) {
        if (s === u.id) continue; const c = cells.get(s); if (c) kin.add(cellKey(c));
      }
      if (neighbours(own).some((nb) => kin.has(cellKey(nb)))) touching++;
      if (parent && hexDistance(own, centre) < hexDistance(parent, centre)) {
        curled++; worst = Math.max(worst, hexDistance(parent, centre) - hexDistance(own, centre));
      }
    }
    if (!u.childIds.length) continue;
    families++;
    const patch = new Set([cellKey(own)]);
    for (const id of u.childIds) { const c = cells.get(id); if (c) patch.add(cellKey(c)); }
    const seen = new Set([cellKey(own)]); const stack = [own];
    while (stack.length) {
      const at = stack.pop()!;
      for (const nb of neighbours(at)) {
        const k = cellKey(nb);
        if (patch.has(k) && !seen.has(k)) { seen.add(k); stack.push(nb); }
      }
    }
    if (seen.size === patch.size) whole++;
  }
  return { buried, children, touching, families, whole, curled, worst };
}
const pct = (n: number, d: number) => `${((100 * n) / Math.max(1, d)).toFixed(1)}%`;

const { org, groups, leads } = buildLabCompany("northwind", "people");
const tree = buildOrbitalTree(org, { mergePassThroughRoot: false, workCountFor: () => 6 });
const peopleIds = new Set(groups.map(([id]) => id));
const base = layoutTerritories(tree, { leads: new Set(leads), people: peopleIds });

const groupMap = new Map(groups);
const groupOf = (id: string) => groupMap.get(id) ?? id;

const branch = branchOf(tree, EVEREST);
const own = base.cells.get(EVEREST)!;
const size = hexSizeFor("roomy");

/** A cell that is occupied by somebody who is NOT in the moving branch. */
const clashTarget = (() => {
  for (const [key, id] of base.occupants) {
    if (branch.has(id)) continue;
    const [q, r] = key.split(",").map(Number);
    const d = hexDistance({ q, r }, own);
    if (d > 25 && d < 60) return { q, r };
  }
  return { q: own.q + 30, r: own.r };
})();

const root = base.cells.get(tree.rootId)!;
const scenarios: [string, Cell][] = [
  ["empty ground (control)", { q: own.q + 14, r: own.r - 9 }],
  ["56 cells overlap (halfway to centre)",
    { q: Math.round((own.q + root.q) / 2), r: Math.round((own.r + root.r) / 2) }],
  ["onto the centre itself", { q: root.q + 3, r: root.r }],
];
void clashTarget;

console.log(`Everest Region: ${branch.size} units in branch · own cell (${own.q},${own.r})`);
console.log(`clash target (${clashTarget.q},${clashTarget.r}) — held by "${tree.units.get(base.occupants.get(cellKey(clashTarget))!)?.name}"\n`);
console.log("scenario".padEnd(46) + "bur   touching family       whole branch   curled");
const row = (label: string, m: ReturnType<typeof measure>) =>
  console.log(label.padEnd(46)
    + `${String(m.buried).padStart(3)}  `
    + `${pct(m.touching, m.children).padStart(6)} (${String(m.children - m.touching).padStart(4)})  `
    + `${String(m.whole).padStart(4)}/${m.families}  `
    + `${pct(m.curled, m.children).padStart(6)} (worst ${m.worst})`);

row("clean load — whole company", measure(tree, base.cells));
row("clean load — Everest branch only", measure(tree, base.cells, branch));

for (const [label, target] of scenarios) {
  for (const mode of ["groupOf", "neither"] as const) {
    const cells = new Map(base.cells);
    const occupants = new Map(base.occupants);
    const members = new Map<string, Cell>();
    for (const m of branch) { const c = cells.get(m); if (c) members.set(m, c); }
    const landing = placeIsland(
      occupants, members, EVEREST, target,
      (id) => tree.units.get(id)?.childIds ?? [], null,
      mode === "neither" ? undefined : groupOf,
    );
    const tag = `${label} · ${mode}`;
    if (landing.kind === "no-room") { console.log(`${tag.padEnd(46)}  DROP REFUSED`); continue; }
    for (const [mid, c] of landing.cells) cells.set(mid, c);
    occupants.clear();
    for (const [uid, c] of cells) occupants.set(cellKey(c), uid);
    row(`${tag} [${landing.kind}]`, measure(tree, cells, branch));
    const t = neaten(tree, cells, new Set([EVEREST]), size);
    row(`   └ then tidy (${t.gathered}g ${t.turned}t)`, measure(tree, new Map(t.cells), branch));
  }
}
