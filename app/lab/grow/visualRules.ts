import { SEAT_RADIUS } from '@/lib/orbital/geometry';
import { smoothstep } from '@/lib/orbital/lod';

export type StudyRingKey = 'delivery' | 'sprint' | 'health';
export type StudyRingAlert = { severity: 'watch' | 'risk'; description: string };
export type StudyRingProgress = Record<StudyRingKey, number> & {
  alerts?: Partial<Record<StudyRingKey, StudyRingAlert>>;
};

export const STUDY_RING_HUES: Record<StudyRingKey, string> = {
  delivery: '#5767e8',
  sprint: '#d944ce',
  health: '#24c6dd',
};

const blendWithWhite = (hex: string, strength: number): string => {
  const amount = Math.max(0, Math.min(1, strength));
  const channels = [1, 3, 5].map((index) => {
    const colour = Number.parseInt(hex.slice(index, index + 2), 16);
    return Math.round(255 + (colour - 255) * amount).toString(16).padStart(2, '0');
  });
  return `#${channels.join('')}`;
};

/** A healthy ring deepens continuously from half-strength to its full hue.
 * Warnings are categorical: they must not be mistaken for low completion. */
export function studyRingColor(key: StudyRingKey, value: number, alert?: StudyRingAlert): string {
  if (alert?.severity === 'risk') return '#ff3048';
  if (alert?.severity === 'watch') return '#f59b29';
  return blendWithWhite(STUDY_RING_HUES[key], 0.5 + 0.5 * Math.max(0, Math.min(1, value)));
}

/** Study-specific cadence: the first child gauges still arrive around .4x,
 * then each deeper layer gets a visibly separate turn around .6x, .8x, etc.
 * The shipped /org reveal is deliberately unchanged by this experiment. */
export function studyRingReveal(depth: number, zoom: number): number {
  if (depth <= 0) return 1;
  const start = 0.3 + (depth - 1) * 0.2;
  return smoothstep(start, start + 0.18, zoom);
}

/** People use a nearer orbit even when their parent also has child teams.
 * Pull back 50% from the last study's close orbit to clear the data rings. */
export function personOrbitRadius(parentRadius: number, count: number, gap: number): number {
  const priorDistance = parentRadius + SEAT_RADIUS + gap * 0.5;
  const clearParent = parentRadius + SEAT_RADIUS + 6;
  const packed = count * (2 * SEAT_RADIUS + 8) / (2 * Math.PI);
  return Math.max(priorDistance * 0.5, clearParent, packed) * 1.5;
}
