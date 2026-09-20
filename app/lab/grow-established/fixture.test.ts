import { describe, expect, it } from 'vitest';
import { establishedNodes, establishedRings } from './fixture';

describe('established grow study', () => {
  it('contains one invented 45-person company with explicit team-only rings', () => {
    const ids = new Set(establishedNodes.map((node) => node.id));
    expect(ids.size).toBe(establishedNodes.length);
    expect(establishedNodes.filter((node) => node.kind === 'person')).toHaveLength(45);
    expect(establishedNodes.filter((node) => node.kind === 'team')).toHaveLength(12);
    expect(establishedNodes.filter((node) => node.parentId === null)).toHaveLength(1);
    for (const node of establishedNodes) {
      if (node.parentId) expect(ids.has(node.parentId)).toBe(true);
      expect(establishedRings[node.id] === undefined).toBe(node.kind === 'person');
    }
  });
});
