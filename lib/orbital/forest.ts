/**
 * Place independently rooted organisations without giving them a fictional
 * common parent. `buildOrbitalTree` still uses an internal synthetic root to
 * run its existing indexes; no such node or link appears in this scene.
 */
import { layoutBranches } from "./branches";
import { treeForFocus } from "./focus";
import { layoutOrbital, type LayoutOptions, type OrbitalScene, type PlacedSeat } from "./layout";
import type { OrbitalTree } from "./model";
import type { Point } from "./geometry";

const ISLAND_GAP = 220;
const BOUNDARY_PAD = 82;

export function visibleRootIds(tree: OrbitalTree): string[] {
  const root = tree.units.get(tree.rootId);
  if (!root) return [];
  return tree.rootId === "orbital-root" ? root.childIds.filter((id) => tree.units.has(id)) : [tree.rootId];
}

const move = (point: Point, by: Point): Point => ({ x: point.x + by.x, y: point.y + by.y });

export function layoutOrbitalForest(tree: OrbitalTree, options: LayoutOptions = {}): OrbitalScene {
  const local = options.geography === "local";
  const layoutOne = (subtree: OrbitalTree) =>
    local ? layoutBranches(subtree, {
      startAngle: options.startAngle,
      radialLooseness: options.radialLooseness,
    }) : layoutOrbital(subtree, options);
  const roots = visibleRootIds(tree);
  if (roots.length <= 1) {
    const solo = roots[0] ? treeForFocus(tree, roots[0]) : null;
    const scene = layoutOne(solo ?? tree);
    const rootId = roots[0] ?? tree.rootId;
    return {
      ...scene,
      families: roots.length > 0 ? [{ rootId, centre: { x: 0, y: 0 }, boundary: scene.extent + BOUNDARY_PAD, bands: scene.bands }] : [],
    };
  }

  const islands = roots.map((rootId) => {
    const subtree = treeForFocus(tree, rootId);
    if (!subtree) throw new Error(`Missing orbital root ${rootId}`);
    const scene = layoutOne(subtree);
    return { rootId, scene, boundary: scene.extent + BOUNDARY_PAD };
  });

  // Two roots form a line, three a triangle, four a square; larger forests
  // use centred rows. Content-sized cells keep a large family from colliding
  // with a small one without making the small family's own orbit enormous.
  const columns = roots.length <= 4 ? 2 : Math.ceil(Math.sqrt(roots.length));
  const rows = Array.from({ length: Math.ceil(islands.length / columns) }, (_, i) =>
    islands.slice(i * columns, (i + 1) * columns));
  const rowSizes = rows.map((row) => ({
    width: row.reduce((sum, island) => sum + 2 * island.boundary, 0) + ISLAND_GAP * (row.length - 1),
    height: Math.max(...row.map((island) => 2 * island.boundary)),
  }));
  const totalHeight = rowSizes.reduce((sum, row) => sum + row.height, 0) + ISLAND_GAP * (rows.length - 1);

  const units: OrbitalScene["units"] = [];
  const seats: OrbitalScene["seats"] = [];
  const links: OrbitalScene["links"] = [];
  const families: NonNullable<OrbitalScene["families"]> = [];
  let top = -totalHeight / 2;
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
    const row = rows[rowIndex];
    const rowSize = rowSizes[rowIndex];
    let left = -rowSize.width / 2;
    for (const island of row) {
      const by = { x: left + island.boundary, y: top + rowSize.height / 2 };
      units.push(...island.scene.units.map((unit) => ({ ...unit, ...move(unit, by) })));
      seats.push(...island.scene.seats.map((seat): PlacedSeat => ({
        ...seat,
        ...move(seat, by),
        work: seat.work.map((point) => move(point, by)),
      })));
      links.push(...island.scene.links.map((link) => ({
        ...link,
        from: move(link.from, by),
        to: move(link.to, by),
      })));
      families.push({ rootId: island.rootId, centre: by, boundary: island.boundary, bands: island.scene.bands });
      left += island.boundary * 2 + ISLAND_GAP;
    }
    top += rowSize.height + ISLAND_GAP;
  }

  const unitById = new Map(units.map((unit) => [unit.id, unit]));
  const seatById = new Map(seats.map((seat) => [seat.id, seat]));
  const seatsByUnit = new Map<string, PlacedSeat[]>();
  for (const seat of seats) seatsByUnit.set(seat.unitId, [...(seatsByUnit.get(seat.unitId) ?? []), seat]);
  const extent = Math.max(...families.map((family) => Math.hypot(family.centre.x, family.centre.y) + family.boundary));
  // Local islands carry settled bounds; move them with their island.
  const bounds = local
    ? families.reduce((acc, family, i) => {
      const b = islands[i].scene.bounds!;
      return {
        minX: Math.min(acc.minX, b.minX + family.centre.x),
        minY: Math.min(acc.minY, b.minY + family.centre.y),
        maxX: Math.max(acc.maxX, b.maxX + family.centre.x),
        maxY: Math.max(acc.maxY, b.maxY + family.centre.y),
      };
    }, { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity })
    : undefined;
  return { units, seats, links, bands: [], unitById, seatById, seatsByUnit,
    extent, maxDepth: Math.max(...islands.map((island) => island.scene.maxDepth)), families,
    ...(local ? { geography: "local" as const, bounds } : {}) };
}
