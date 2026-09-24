/**
 * The focus stack — which unit the map is currently standing inside, and how
 * you got there (part of the camera engine; see docs/ENGINES.md).
 *
 * Focus is a *stack*, not a single id, because you can focus a value stream,
 * then a team inside it, then leave the team and still be inside the stream.
 * The breadcrumb is that stack rendered, and clicking a crumb truncates to it.
 *
 * Pure array work, kept here rather than inline in the component because the
 * truncate rule below is genuinely easy to get wrong and impossible to see in
 * a screenshot.
 */
export type FocusFrame = { unitId: string };

/** The unit currently focused, or null at the company. */
export const activeFocus = (frames: readonly FocusFrame[]): string | null =>
  frames[frames.length - 1]?.unitId ?? null;

/** The frame you would return to on leaving this one. */
export const parentFocus = (frames: readonly FocusFrame[]): string | null =>
  frames[frames.length - 2]?.unitId ?? null;

export const hasParentFocus = (frames: readonly FocusFrame[]): boolean => frames.length > 1;

/** Go deeper. Focusing the unit you are already in is a no-op, not a second
 *  identical frame — otherwise Escape needs pressing twice for no reason. */
export const pushFocus = (frames: readonly FocusFrame[], unitId: string): FocusFrame[] =>
  activeFocus(frames) === unitId ? [...frames] : [...frames, { unitId }];

export const popFocus = (frames: readonly FocusFrame[]): FocusFrame[] => frames.slice(0, -1);

export const clearFocus = (): FocusFrame[] => [];

/**
 * Click a breadcrumb.
 *
 * Two different things wear the same gesture:
 *
 * - The crumb is **already in the stack** → step back out to it, dropping
 *   everything deeper. Clicking "Delivery" while inside Delivery ▸ Platform ▸
 *   Payments leaves you in Delivery.
 * - The crumb is **not in the stack** → you are moving sideways to a sibling
 *   at the same depth, so replace the deepest frame rather than nesting into
 *   something you were never inside.
 *
 * An empty stack has nothing to replace, so it stays empty — the caller is at
 * the company already.
 */
export function focusToCrumb(frames: readonly FocusFrame[], unitId: string): FocusFrame[] {
  const existing = frames.findIndex((frame) => frame.unitId === unitId);
  if (existing >= 0) return frames.slice(0, existing + 1);
  if (frames.length === 0) return [];
  return [...frames.slice(0, -1), { unitId }];
}
