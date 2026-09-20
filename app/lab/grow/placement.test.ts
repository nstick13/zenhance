import { describe, expect, it } from 'vitest';
import { buildLayout, canArmTeamMerge, classifyDrop, type Node } from './GrowLab';

const team = (id: string, parentId: string | null): Node =>
  ({ id, parentId, kind: 'team', name: id, role: null, purpose: null });
const person = (id: string, parentId: string): Node =>
  ({ id, parentId, kind: 'person', name: id, role: null, purpose: null });
const angleTo = (layout: ReturnType<typeof buildLayout>, parentId: string, childId: string): number => {
  const parent = layout.pos[parentId];
  const child = layout.pos[childId];
  return Math.atan2(child.y - parent.y, child.x - parent.x);
};
const distanceTo = (layout: ReturnType<typeof buildLayout>, parentId: string, childId: string): number => {
  const parent = layout.pos[parentId];
  const child = layout.pos[childId];
  return Math.hypot(child.x - parent.x, child.y - parent.y);
};
const angleDifference = (a: number, b: number): number =>
  Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));

describe('grow study child orbits', () => {
  it('adds a team beyond the human orbit at the chosen angle without spinning existing people', () => {
    const first = [team('root', null), person('ana', 'root'), person('ben', 'root')];
    const before = buildLayout(first, {});
    const anaAngle = angleTo(before, 'root', 'ana');
    const benAngle = angleTo(before, 'root', 'ben');
    const after = buildLayout([...first, team('new-team', 'root')], {}, {
      ana: anaAngle, ben: benAngle, 'new-team': -Math.PI / 2,
    });

    expect(after.personRing.root).toBeLessThan(after.ring.root);
    expect(distanceTo(after, 'root', 'new-team')).toBeCloseTo(after.ring.root);
    expect(distanceTo(after, 'root', 'ana')).toBeCloseTo(after.personRing.root);
    expect(angleDifference(angleTo(after, 'root', 'new-team'), -Math.PI / 2)).toBeLessThan(0.01);
    expect(angleDifference(angleTo(after, 'root', 'ana'), anaAngle)).toBeLessThan(0.01);
    expect(angleDifference(angleTo(after, 'root', 'ben'), benAngle)).toBeLessThan(0.01);
  });

  it('keeps child placement available at arbitrary depth', () => {
    const nodes = [team('root', null), team('division', 'root'), team('group', 'division'),
      team('team', 'group'), team('subteam', 'team'), person('worker', 'subteam')];
    const layout = buildLayout(nodes, {});
    expect(layout.depth.subteam).toBe(4);
    expect(layout.depth.worker).toBe(5);
    expect(distanceTo(layout, 'team', 'subteam')).toBeCloseTo(layout.ring.team);
  });

  it('treats the human orbit as child placement and only the inside as merge', () => {
    const nodes = [team('target', null), person('ana', 'target'), team('moved', null)];
    const layout = buildLayout(nodes, {});
    const R = layout.personRing.target;
    const at = { x: layout.pos.target.x + R, y: layout.pos.target.y };
    expect(classifyDrop(layout, 'moved', at)).toMatchObject({ parentId: 'target', orbit: 'people' });
    const combined = layout.radius.target + layout.radius.moved;
    expect(canArmTeamMerge(layout, 'target', R, combined)).toBe(false);
    expect(canArmTeamMerge(layout, 'target', Math.min(R * 0.7, combined * 1.8), combined)).toBe(true);
  });
});
