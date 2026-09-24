/**
 * Progressive visibility — what the map spends its screen on (Greg,
 * 2026-09-21).
 *
 * At maximum overview a large company must not draw every unit just to say
 * that it exists: two thousand equally insistent dots read as fog. The map
 * gets a *budget* of marks for what is on screen and spends it in order:
 *
 *   1. the company (or the focused unit) and anything forced — the selected
 *      unit, its immediate children, and every route home from them
 *   2. major branches, by the headcount they carry
 *   3. whatever sits near the local detail field
 *   4. smaller surrounding units, while room remains
 *
 * The spend is *hierarchical*: a unit is only considered once its parent has
 * been admitted, so a descendant never appears before the structure that
 * leads to it. The walk is a best-first expansion of the tree — the frontier
 * is always "children of what is already shown", ordered by priority.
 *
 * A unit hidden here still exists: it still holds its place in the settled
 * geography and still counts toward the map's extent. This module decides
 * only what is painted and what can be pointed at.
 *
 * Only marks inside the view spend budget. Off-screen units are admitted
 * free, so their descendants that *are* on screen can still be reached —
 * a parent off to one side must not hide a whole visible team.
 */
import { fieldInfluence, type DetailField } from "./detail";

export type VisibilityUnit = {
  id: string;
  parentId: string | null;
  x: number;
  y: number;
  /** 0..1 — the size index: how much of the company this unit carries. */
  weight: number;
};

export type ViewRect = { minX: number; minY: number; maxX: number; maxY: number };

export type VisibilityInput = {
  units: readonly VisibilityUnit[];
  view: ViewRect;
  /** How many marks the visible screen may carry. */
  budget: number;
  scale: number;
  field?: DetailField | null;
  /** Shown whatever the budget. Their ancestors are shown too, so a forced
   *  unit is never an island without its route home. */
  forced?: ReadonlySet<string>;
  /** When a branch is focused, units outside it are context: still eligible,
   *  but spent on last. */
  branch?: ReadonlySet<string> | null;
};

/** How much the field outranks headcount. At full strength a small team
 *  inside the field beats a mid-sized branch elsewhere, but not the company's
 *  largest divisions. */
const FIELD_PRIORITY = 0.55;
const OUTSIDE_BRANCH = 0.25;

/** Screen area each mark is allowed on average. Calibrated so the old iPad
 *  (1024×768) carries ~120 structural marks and a phone ~45. */
const AREA_PER_MARK = 6500;
export const MIN_MARK_BUDGET = 28;
export const MAX_MARK_BUDGET = 180;

export function markBudget(viewport: { width: number; height: number }): number {
  const raw = Math.floor((viewport.width * viewport.height) / AREA_PER_MARK);
  return Math.min(MAX_MARK_BUDGET, Math.max(MIN_MARK_BUDGET, raw));
}

const inView = (u: VisibilityUnit, v: ViewRect) =>
  u.x >= v.minX && u.x <= v.maxX && u.y >= v.minY && u.y <= v.maxY;

/** A binary max-heap keyed on priority, tie-broken by input order so the
 *  result never depends on anything but its inputs. */
class Frontier {
  private items: { index: number; priority: number }[] = [];
  get size() { return this.items.length; }
  push(index: number, priority: number) {
    const items = this.items;
    items.push({ index, priority });
    let i = items.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (!this.before(items[i], items[parent])) break;
      [items[i], items[parent]] = [items[parent], items[i]];
      i = parent;
    }
  }
  pop(): number {
    const items = this.items;
    const top = items[0];
    const last = items.pop()!;
    if (items.length > 0) {
      items[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let best = i;
        if (l < items.length && this.before(items[l], items[best])) best = l;
        if (r < items.length && this.before(items[r], items[best])) best = r;
        if (best === i) break;
        [items[i], items[best]] = [items[best], items[i]];
        i = best;
      }
    }
    return top.index;
  }
  private before(a: { index: number; priority: number }, b: { index: number; priority: number }) {
    return a.priority > b.priority || (a.priority === b.priority && a.index < b.index);
  }
}

export function visibleUnitIds(input: VisibilityInput): Set<string> {
  const { units, view, budget, scale, field, forced, branch } = input;
  const indexById = new Map(units.map((u, i) => [u.id, i]));
  const children: number[][] = units.map(() => []);
  const roots: number[] = [];
  units.forEach((u, i) => {
    const parent = u.parentId != null ? indexById.get(u.parentId) : undefined;
    if (parent === undefined) roots.push(i);
    else children[parent].push(i);
  });

  // Forcing a unit forces its whole route home.
  const mustShow = new Set<string>();
  for (const id of forced ?? []) {
    let cursor = indexById.get(id);
    const guard = new Set<number>();
    while (cursor !== undefined && !guard.has(cursor)) {
      guard.add(cursor);
      mustShow.add(units[cursor].id);
      const parentId = units[cursor].parentId;
      cursor = parentId != null ? indexById.get(parentId) : undefined;
    }
  }

  const priority = (i: number) => {
    const u = units[i];
    if (mustShow.has(u.id)) return Infinity;
    const near = fieldInfluence(field ?? null, u, scale);
    const base = u.weight + FIELD_PRIORITY * near;
    return branch && !branch.has(u.id) ? base * OUTSIDE_BRANCH : base;
  };

  const shown = new Set<string>();
  const frontier = new Frontier();
  let spent = 0;
  const admit = (i: number) => {
    shown.add(units[i].id);
    for (const c of children[i]) frontier.push(c, priority(c));
  };

  // The company — or each independent family's root — is always there.
  for (const r of roots) {
    admit(r);
    if (inView(units[r], view)) spent++;
  }

  while (frontier.size > 0) {
    const i = frontier.pop();
    const u = units[i];
    if (!inView(u, view)) {
      admit(i);
      continue;
    }
    if (mustShow.has(u.id)) {
      admit(i);
      spent++;
      continue;
    }
    if (spent >= budget) continue;
    admit(i);
    spent++;
  }
  return shown;
}

/** How long a mark takes to fade in or out. Opacity rather than movement, so
 *  it survives reduced motion — only shortened. */
export const PRESENCE_IN_S = 0.32;
export const PRESENCE_OUT_S = 0.22;
export const PRESENCE_REDUCED_S = 0.12;

/** Ease presence toward its target at a fixed rate — continuous, so a mark
 *  crossing the budget line fades rather than pops. */
export function stepPresence(current: number, target: number, dt: number, reduced = false): number {
  if (current === target) return current;
  const seconds = reduced ? PRESENCE_REDUCED_S : target > current ? PRESENCE_IN_S : PRESENCE_OUT_S;
  const step = dt / Math.max(seconds, 1e-6);
  return target > current ? Math.min(target, current + step) : Math.max(target, current - step);
}

/** Newly admitted marks arrive in a ripple outward from where the user acted
 *  rather than all at once across the map — no popcorn. */
export const REVEAL_RIPPLE_PX_PER_S = 1400;
export const REVEAL_MAX_DELAY_S = 0.28;

export function revealDelay(distancePx: number, reduced = false): number {
  if (reduced) return 0;
  return Math.min(REVEAL_MAX_DELAY_S, Math.max(0, distancePx) / REVEAL_RIPPLE_PX_PER_S);
}
