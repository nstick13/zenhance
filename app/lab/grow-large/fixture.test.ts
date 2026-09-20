import { describe, expect, it } from 'vitest';
import { buildLayout } from '../grow/GrowLab';
import { largeNodes, largeRings, largeWork } from './fixture';

describe('large grow study fixture', () => {
  it('has 1,000 invented people, a 30-level main branch and a 10-level floating family', () => {
    expect(largeNodes.filter((node) => node.kind === 'person')).toHaveLength(1000);
    const byId = new Map(largeNodes.map((node) => [node.id, node]));
    const depthOf = (id: string) => {
      let depth = 0;
      let node = byId.get(id);
      while (node?.parentId) {
        depth++;
        node = byId.get(node.parentId);
      }
      return depth;
    };
    expect(depthOf('large-deep-30')).toBe(30);
    expect(depthOf('large-floating-10')).toBe(9);
    expect(largeNodes.filter((node) => node.parentId === null)).toHaveLength(2);
    expect(largeNodes.every((node) => node.parentId === null || byId.has(node.parentId))).toBe(true);
    expect(Object.keys(largeRings).length).toBeLessThan(largeNodes.filter((node) => node.kind === 'team').length);
    expect(largeRings['large-deep-15']).toBeDefined();
    expect(largeRings['large-floating-10']).toBeDefined();
    expect(Object.keys(largeWork).length).toBeLessThan(1000);
  });

  it('keeps both family centres separate and the map bounded at this depth', () => {
    const layout = buildLayout(largeNodes, {}, {}, 'large');
    expect(Math.max(...Object.values(layout.reach))).toBeLessThan(100_000);
    expect(layout.pos['large-centre']).not.toEqual(layout.pos['large-floating-1']);
    expect(Object.values(layout.pos).every((point) => Number.isFinite(point.x) && Number.isFinite(point.y))).toBe(true);
  });
});
