/**
 * `npx tsx scripts/hexZoning.ts` — the figures the absolute-arc work answers to.
 *
 * Every number here is counted from the laid map rather than read off a stat the
 * placer kept, because the house rule after curl-back is to count the thing Greg
 * is pointing at. Each metric says in a comment what it counts and what it does
 * not.
 */
import { buildLabCompany, COMPANIES, type CompanyKey, type Strata } from "@/app/lab/hex/company";
import { buildOrbitalTree, type OrbitalTree } from "@/lib/map/layout/model";
import { allocateByTerritory } from "@/lib/map/layout/hex/territory";
import { spacerRule } from "@/lib/map/layout/hex/spacing";
import { cellKey, hexDistance, neighbours, worldAngle, type Cell } from "@/lib/map/layout/hex/coords";

const ORIGIN: Cell = { q: 0, r: 0 };
const DEG = 180 / Math.PI;

export type Laid = {
  tree: OrbitalTree;
  people: Set<string>;
  cells: ReadonlyMap<string, Cell>;
  ms: number;
  radius: number;
  placed: number;
  unplaced: number;
  strayed: number;
};

export function lay(key: CompanyKey, strata: Strata, opts: Record<string, unknown> = {}): Laid {
  const { org, groups, leads } = buildLabCompany(key, strata);
  const tree = buildOrbitalTree(org, { mergePassThroughRoot: false, workCountFor: () => 6 });
  const people = new Set(groups.map(([id]) => id));
  const leadIds = new Set(leads);
  const t0 = performance.now();
  const a = allocateByTerritory(tree, { leads: leadIds, people, driver: "radial", sideways: "forbid", ...opts });
  const ms = performance.now() - t0;
  return {
    tree, people, cells: a.cells, ms, radius: a.radius,
    placed: a.stats.placed, unplaced: tree.units.size - a.cells.size, strayed: a.stats.strayed ?? 0,
  };
}

/** Pairs of adjacent occupied cells the spacer rule forbids. Law 4. */
export function breaches(l: Laid): number {
  const { mayTouch } = spacerRule(l.tree, l.people);
  const at = new Map<string, string>();
  for (const [id, cell] of l.cells) at.set(cellKey(cell), id);
  let bad = 0;
  const seen = new Set<string>();
  for (const [id, cell] of l.cells) {
    for (const near of neighbours(cell)) {
      const other = at.get(cellKey(near));
      if (other === undefined || other === id) continue;
      const pair = id < other ? `${id}|${other}` : `${other}|${id}`;
      if (seen.has(pair)) continue;
      seen.add(pair);
      if (!mayTouch(id, other)) bad++;
    }
  }
  return bad;
}

/**
 * **Teams in one piece.** A team is a structural node; its crowd is every person
 * whose nearest structural ancestor is it — which is the people a reader sees
 * gathered round that node, including those who report to a lead rather than to
 * the node itself. In one piece means the node's cell and the whole crowd form a
 * single connected patch. Law 2, counted on the thing a reader calls a team.
 */
export function teamsWhole(l: Laid): { whole: number; teams: number } {
  const { teamFor } = spacerRule(l.tree, l.people);
  const crowd = new Map<string, string[]>();
  for (const id of l.people) {
    const team = teamFor(id);
    if (!team) continue;
    const had = crowd.get(team);
    if (had) had.push(id); else crowd.set(team, [id]);
  }
  let teams = 0, whole = 0;
  for (const [team, members] of crowd) {
    teams++;
    const own = l.cells.get(team);
    if (!own) continue;
    const patch = new Set([cellKey(own)]);
    for (const id of members) { const c = l.cells.get(id); if (c) patch.add(cellKey(c)); }
    const seen = new Set([cellKey(own)]);
    const stack: Cell[] = [own];
    while (stack.length) {
      const at = stack.pop()!;
      for (const nb of neighbours(at)) {
        const k = cellKey(nb);
        if (patch.has(k) && !seen.has(k)) { seen.add(k); stack.push(nb); }
      }
    }
    if (seen.size === patch.size) whole++;
  }
  return { whole, teams };
}

/** Rungs at team level and above that take you no further from the centre. Law 3. */
export function roundRungs(l: Laid): { round: number; rungs: number } {
  let round = 0, rungs = 0;
  for (const unit of l.tree.units.values()) {
    if (l.people.has(unit.id) || !unit.parentId) continue;
    const own = l.cells.get(unit.id);
    const parent = l.cells.get(unit.parentId);
    if (!own || !parent) continue;
    rungs++;
    if (hexDistance(own, ORIGIN) <= hexDistance(parent, ORIGIN)) round++;
  }
  return { round, rungs };
}

/** Units whose cell touches their parent's or a sibling's. */
export function touchingFamily(l: Laid): { touching: number; children: number } {
  let touching = 0, children = 0;
  for (const unit of l.tree.units.values()) {
    const own = l.cells.get(unit.id);
    if (!own || !unit.parentId) continue;
    children++;
    const kin = new Set<string>();
    const parent = l.cells.get(unit.parentId);
    if (parent) kin.add(cellKey(parent));
    for (const sib of l.tree.units.get(unit.parentId)?.childIds ?? []) {
      if (sib === unit.id) continue;
      const c = l.cells.get(sib);
      if (c) kin.add(cellKey(c));
    }
    if (neighbours(own).some((nb) => kin.has(cellKey(nb)))) touching++;
  }
  return { touching, children };
}

/** Everything under `id`, itself included. */
export function subtree(tree: OrbitalTree, id: string): string[] {
  const out: string[] = [];
  const stack = [id];
  while (stack.length) {
    const at = stack.pop()!;
    out.push(at);
    for (const kid of tree.units.get(at)?.childIds ?? []) stack.push(kid);
  }
  return out;
}

/** The narrowest arc containing every bearing, in degrees, and its centre. */
function span(angles: number[]): { width: number; from: number; to: number } | null {
  if (!angles.length) return null;
  const sorted = [...angles].sort((a, b) => a - b);
  // The widest empty wedge between consecutive bearings is the complement of the
  // narrowest covering arc, which is how a wrap-around spread is measured without
  // guessing where the seam is.
  let gap = sorted[0] + 2 * Math.PI - sorted[sorted.length - 1];
  let after = sorted.length - 1;
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] - sorted[i - 1] > gap) { gap = sorted[i] - sorted[i - 1]; after = i - 1; }
  }
  const from = sorted[(after + 1) % sorted.length];
  const width = 2 * Math.PI - gap;
  return { width: width * DEG, from: from * DEG, to: (from + width) * DEG };
}

/** How much two arcs, given as [from, from+width] in degrees, share. */
function overlap(a: { from: number; width: number }, b: { from: number; width: number }): number {
  let best = 0;
  for (const shift of [-360, 0, 360]) {
    const lo = Math.max(a.from, b.from + shift);
    const hi = Math.min(a.from + a.width, b.from + shift + b.width);
    best = Math.max(best, hi - lo);
  }
  return best;
}

/**
 * **Branch overlap** — the headline. For a named parent, each child's whole
 * subtree is turned into bearings *as seen from that parent*, the narrowest arc
 * covering each is taken, and the pairwise sharing of those arcs is reported.
 * Three wedges read as small spans and near-nought overlap; three clouds in one
 * space read as what Greg is looking at.
 */
export function branchArcs(l: Laid, parentName: string) {
  const parent = [...l.tree.units.values()].find((u) => u.name === parentName);
  if (!parent) return null;
  const at = l.cells.get(parent.id);
  if (!at) return null;
  const arcs = parent.childIds.map((id) => {
    const kid = l.tree.units.get(id)!;
    const angles: number[] = [];
    for (const member of subtree(l.tree, id)) {
      const c = l.cells.get(member);
      if (!c || (c.q === at.q && c.r === at.r)) continue;
      angles.push(worldAngle(at, c, 1));
    }
    const s = span(angles);
    return { name: kid.name, units: angles.length, span: s };
  });
  const pairs: { a: string; b: string; shared: number }[] = [];
  for (let i = 0; i < arcs.length; i++) {
    for (let j = i + 1; j < arcs.length; j++) {
      const x = arcs[i].span, y = arcs[j].span;
      if (!x || !y) continue;
      pairs.push({
        a: arcs[i].name, b: arcs[j].name,
        shared: overlap({ from: x.from, width: x.width }, { from: y.from, width: y.width }),
      });
    }
  }
  return { parent: parent.name, arcs, pairs };
}

const pct = (n: number, d: number) => d === 0 ? "—" : `${((n / d) * 100).toFixed(1)}%`;

export function report(key: CompanyKey, strata: Strata, opts: Record<string, unknown> = {}) {
  const l = lay(key, strata, opts);
  const t = teamsWhole(l);
  const r = roundRungs(l);
  const f = touchingFamily(l);
  console.log(
    `${COMPANIES[key].label} · ${strata}`.padEnd(34)
    + ` ${l.ms.toFixed(0)}ms`.padEnd(9)
    + ` units ${l.placed}`.padEnd(13)
    + ` unplaced ${l.unplaced}`.padEnd(13)
    + ` radius ${l.radius}`.padEnd(12)
    + ` spacer ${breaches(l)}`.padEnd(12)
    + ` teams ${t.whole}/${t.teams}`.padEnd(17)
    + ` round ${r.round}/${r.rungs}`.padEnd(16)
    + ` family ${pct(f.touching, f.children)}`.padEnd(15)
    + ` strayed ${l.strayed}`,
  );
  return l;
}

export function granite(opts: Record<string, unknown> = {}) {
  const nw = lay("northwind", "people", opts);
  const g = branchArcs(nw, "Granite Division");
  if (!g) return;
  console.log(`Granite Division's children, as seen from Granite:`);
  for (const a of g.arcs) {
    console.log(`  ${a.name.padEnd(24)} ${String(a.units).padStart(5)} units  span ${a.span ? a.span.width.toFixed(0) + "°" : "—"}`);
  }
  for (const p of g.pairs) console.log(`  overlap ${p.a} × ${p.b}: ${p.shared.toFixed(0)}°`);
}

if (process.argv[1]?.endsWith("hexZoning.ts")) {
  const strataList: Strata[] = ["teams", "people"];
  for (const key of ["small", "medium", "northwind"] as CompanyKey[]) {
    for (const strata of strataList) report(key, strata);
  }
  console.log("");
  granite();
}
