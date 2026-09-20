import { describe, expect, it } from 'vitest';
import { establishedNodes, establishedRings, establishedWork } from './fixture';

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
      expect(establishedWork[node.id] === undefined).toBe(node.kind === 'team');
      if (node.kind === 'person') expect(establishedWork[node.id].length).toBeGreaterThan(0);
    }
  });

  it('keeps the study alerts explicit and attached to invented team metrics', () => {
    expect(establishedRings['est-root'].alerts).toBeUndefined();
    expect(establishedRings['est-sales'].alerts?.sprint?.severity).toBe('watch');
    expect(establishedRings['est-fulfilment'].alerts?.delivery?.severity).toBe('risk');
    expect(establishedRings['est-support'].alerts?.health?.description).toContain('capacity');
  });
});
