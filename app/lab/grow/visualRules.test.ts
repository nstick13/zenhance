import { describe, expect, it } from 'vitest';
import { personOrbitRadius, studyRingColor, studyRingReveal, STUDY_RING_HUES } from './visualRules';

describe('grow study visual cadence', () => {
  it('stages successive team gauges around .4x, .6x and .8x', () => {
    expect(studyRingReveal(1, 0.39)).toBeGreaterThan(0.4);
    expect(studyRingReveal(2, 0.5)).toBe(0);
    expect(studyRingReveal(2, 0.59)).toBeGreaterThan(0.4);
    expect(studyRingReveal(3, 0.8)).toBeGreaterThan(0.4);
  });

  it('adds 50% breathing room to the close seat orbit without losing crowd packing', () => {
    expect(personOrbitRadius(20, 5, 114)).toBeCloseTo((20 + 9.5 + 114 * 0.5) * 0.5 * 1.5);
    expect(personOrbitRadius(20, 30, 114)).toBeGreaterThan(personOrbitRadius(20, 5, 114));
    expect(personOrbitRadius(60, 1, 114)).toBeGreaterThan(60 + 9.5);
  });

  it('deepens three distinct hues smoothly, with categorical orange and red alerts', () => {
    for (const key of ['delivery', 'sprint', 'health'] as const) {
      expect(studyRingColor(key, 1)).toBe(STUDY_RING_HUES[key]);
      expect(studyRingColor(key, 0)).not.toBe(STUDY_RING_HUES[key]);
      expect(studyRingColor(key, 0.5)).not.toBe(studyRingColor(key, 0));
    }
    expect(new Set(Object.values(STUDY_RING_HUES)).size).toBe(3);
    expect(studyRingColor('delivery', 0.8, { severity: 'watch', description: 'Soon' })).toBe('#f59b29');
    expect(studyRingColor('health', 0.8, { severity: 'risk', description: 'Blocked' })).toBe('#ff3048');
  });
});
