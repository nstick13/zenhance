/**
 * The spring that makes the map feel alive: nothing on the orbital map ever
 * jumps to a new position, it *travels* there. When a drag reparents a node,
 * its whole subtree re-lays-out and every affected node eases across —
 * which is the "bubbling between nodes" feel (Greg, 2026-09-13) and costs
 * nothing but arithmetic, no lensing or blur.
 *
 * Pure and frame-rate independent: the renderer owns the clock, this owns
 * the physics. A node seen for the first time is seeded *at* its target so
 * new nodes appear where they belong instead of flying in from the origin.
 */

export type Spring = { value: number; velocity: number };

export type SpringConfig = {
  /** Pull toward the target. Higher = faster, more eager. */
  stiffness: number;
  /** Resistance. Below ~2·√stiffness it overshoots slightly — the bounce. */
  damping: number;
};

/** Motion for position: a touch of overshoot so a node settles rather than stops. */
export const TRAVEL: SpringConfig = { stiffness: 150, damping: 21 };
/** Motion for scale/opacity: quicker and flatter, so a pickup reads instantly. */
export const ACCENT: SpringConfig = { stiffness: 260, damping: 30 };

/** Longest step the integrator will take. A backgrounded tab hands back one
 *  enormous frame; without this the spring explodes on return. */
const MAX_STEP = 1 / 30;
/** Below this the spring is done — stop integrating and sit exactly on target. */
const REST = 0.01;

export function stepSpring(spring: Spring, target: number, dt: number, cfg: SpringConfig): boolean {
  const step = Math.min(dt, MAX_STEP);
  const offset = spring.value - target;
  if (Math.abs(offset) < REST && Math.abs(spring.velocity) < REST) {
    spring.value = target;
    spring.velocity = 0;
    return false;
  }
  const accel = -cfg.stiffness * offset - cfg.damping * spring.velocity;
  spring.velocity += accel * step;
  spring.value += spring.velocity * step;
  return true;
}

export type MotionTarget = { x: number; y: number; scale: number };

export type MotionState = {
  x: Spring;
  y: Spring;
  scale: Spring;
};

/**
 * Springs for a whole scene, keyed by node id. The renderer writes targets
 * every time the layout changes and reads positions every frame.
 */
export class MotionStore {
  private readonly states = new Map<string, MotionState>();

  /** Current animated position, seeding at the target the first time. */
  read(id: string, target: MotionTarget): MotionState {
    const existing = this.states.get(id);
    if (existing) return existing;
    const seeded: MotionState = {
      x: { value: target.x, velocity: 0 },
      y: { value: target.y, velocity: 0 },
      scale: { value: target.scale, velocity: 0 },
    };
    this.states.set(id, seeded);
    return seeded;
  }

  peek(id: string): MotionState | undefined {
    return this.states.get(id);
  }

  /** Advance every spring. Returns true while anything is still moving, so
   *  the renderer can stop redrawing once the map has come to rest.
   *
   *  `instant` is for prefers-reduced-motion: everything arrives at once, so
   *  cause and effect stay legible — a gap opens, a branch lands — without
   *  anything travelling across the screen. */
  step(dt: number, targets: Map<string, MotionTarget>, instant = false): boolean {
    let moving = false;
    for (const [id, target] of targets) {
      const state = this.read(id, target);
      if (instant) {
        state.x.value = target.x;
        state.y.value = target.y;
        state.scale.value = target.scale;
        state.x.velocity = state.y.velocity = state.scale.velocity = 0;
        continue;
      }
      if (stepSpring(state.x, target.x, dt, TRAVEL)) moving = true;
      if (stepSpring(state.y, target.y, dt, TRAVEL)) moving = true;
      if (stepSpring(state.scale, target.scale, dt, ACCENT)) moving = true;
    }
    return moving;
  }

  /** Forget nodes that have left the scene, so the store can't grow forever. */
  prune(live: Set<string>): void {
    for (const id of this.states.keys()) {
      if (!live.has(id)) this.states.delete(id);
    }
  }

  /** Drop a node straight onto a position — used while a node is under the
   *  cursor, where following the pointer exactly beats easing behind it. */
  place(id: string, x: number, y: number): void {
    const state = this.states.get(id);
    if (!state) return;
    state.x.value = x;
    state.x.velocity = 0;
    state.y.value = y;
    state.y.velocity = 0;
  }
}
