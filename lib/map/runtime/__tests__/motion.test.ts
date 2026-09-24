import { describe, expect, it } from "vitest";
import { MotionStore } from "@/lib/map/runtime/motion";

describe("reduced-motion travel", () => {
  it("arrives at the joined target immediately with no residual velocity", () => {
    const motion = new MotionStore();
    const start = new Map([["u:a", { x: 0, y: 0, scale: 1 }]]);
    motion.step(1 / 60, start);
    const joined = new Map([["u:a", { x: 80, y: 24, scale: 1.1 }]]);
    expect(motion.step(1 / 60, joined, true)).toBe(false);
    const state = motion.peek("u:a")!;
    expect([state.x.value, state.y.value, state.scale.value]).toEqual([80, 24, 1.1]);
    expect([state.x.velocity, state.y.velocity, state.scale.velocity]).toEqual([0, 0, 0]);
  });
});
