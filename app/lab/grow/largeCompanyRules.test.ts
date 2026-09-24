import { describe, expect, it } from 'vitest';
import {
  addBasketEntry,
  basketOwner,
  effectiveSemanticScale,
  insertionAngles,
  overviewMarkRadius,
  pickVisibleStructure,
  structuralEnvelope,
  structureBudget,
} from './largeCompanyRules';

describe('large-company grow study rules', () => {
  it('adds one bounded local semantic tier without moving the camera', () => {
    expect(effectiveSemanticScale(0.2, 0)).toBeCloseTo(0.82);
    expect(effectiveSemanticScale(0.2, 240)).toBe(0.2);
    expect(effectiveSemanticScale(0.2, 120)).toBeGreaterThan(0.2);
    expect(effectiveSemanticScale(1.4, 0) - 1.4).toBeCloseTo(0.62);
  });

  it('maps headcount monotonically into bounded screen area with a master floor', () => {
    const radii = [0, 1, 10, 100, 1_000, 10_000].map((count) => overviewMarkRadius(count));
    expect(radii).toEqual([...radii].sort((a, b) => a - b));
    expect(radii[0]).toBeGreaterThanOrEqual(3.2);
    expect(radii.at(-1)).toBeLessThanOrEqual(17);
    expect(overviewMarkRadius(0, true)).toBeGreaterThan(overviewMarkRadius(0));
  });

  it('keeps visibility bounded and never exposes a descendant without its route', () => {
    const candidates = [
      { id: 'root', parentId: null, depth: 0, headcount: 1_000, distancePx: 900, root: true },
      { id: 'a', parentId: 'root', depth: 1, headcount: 600, distancePx: 800 },
      { id: 'b', parentId: 'a', depth: 2, headcount: 300, distancePx: 20 },
      { id: 'c', parentId: 'b', depth: 3, headcount: 80, distancePx: 10 },
      ...Array.from({ length: 50 }, (_, index) => ({
        id: `side-${index}`, parentId: 'root', depth: 1, headcount: 1, distancePx: 1_000 + index,
      })),
    ];
    const visible = pickVisibleStructure(candidates, 5);
    expect(visible.size).toBeLessThanOrEqual(5);
    expect(visible.has('c')).toBe(true);
    expect(visible.has('b')).toBe(true);
    expect(visible.has('a')).toBe(true);
    expect(visible.has('root')).toBe(true);
    expect(structureBudget(1_024 * 768, 0.2)).toBeLessThanOrEqual(180);
  });

  it('absorbs descendant basket entries and refuses duplicate carried branches', () => {
    const parents = { root: null, child: 'root', leaf: 'child', other: null };
    expect(addBasketEntry([], 'leaf', parents).ids).toEqual(['leaf']);
    const ancestor = addBasketEntry(['leaf', 'other'], 'root', parents);
    expect(ancestor.ids).toEqual(['other', 'root']);
    expect(ancestor.absorbed).toEqual(['leaf']);
    expect(basketOwner(ancestor.ids, 'child', parents)).toBe('root');
    expect(addBasketEntry(ancestor.ids, 'child', parents).owner).toBe('root');
  });

  it('opens an insertion gap by moving only colliding neighbours', () => {
    const preview = insertionAngles([
      { id: 'far-left', angle: -2 },
      { id: 'left', angle: -0.1 },
      { id: 'dragged', angle: 1.2 },
      { id: 'right', angle: 0.08 },
      { id: 'far-right', angle: 2 },
    ], 'dragged', 0, 0.3);
    expect(preview.dragged).toBe(0);
    expect(preview.left).toBeCloseTo(-0.3);
    expect(preview.right).toBeCloseTo(0.3);
    expect(preview['far-left']).toBeUndefined();
    expect(preview['far-right']).toBeUndefined();
  });

  it('builds a structural envelope outside every supplied unit disc', () => {
    const discs = [{ x: -20, y: 0, r: 10 }, { x: 30, y: 15, r: 8 }];
    const hull = structuralEnvelope(discs, 12);
    expect(hull.length).toBeGreaterThanOrEqual(4);
    for (const disc of discs) {
      expect(Math.min(...hull.map((point) => point.x))).toBeLessThanOrEqual(disc.x - disc.r);
      expect(Math.max(...hull.map((point) => point.x))).toBeGreaterThanOrEqual(disc.x + disc.r);
      expect(Math.min(...hull.map((point) => point.y))).toBeLessThanOrEqual(disc.y - disc.r);
      expect(Math.max(...hull.map((point) => point.y))).toBeGreaterThanOrEqual(disc.y + disc.r);
    }
  });
});
