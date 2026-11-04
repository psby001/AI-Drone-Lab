import { neutralInput, type ControlInput } from '../core/flight';
export const KEY_BINDINGS: Record<string, Partial<ControlInput>> = {
  KeyW: { vertical: 1 }, KeyS: { vertical: -1 },
  KeyQ: { yaw: -1 }, KeyE: { yaw: 1 },
  ArrowUp: { forward: 1 }, ArrowDown: { forward: -1 },
  ArrowLeft: { right: -1 }, ArrowRight: { right: 1 },
};
/** Input adapter only: all motion continues through FlightModel.update(). */
export class ManualController {
  private keys = new Set<string>();
  private sticks = new Map<'left' | 'right', { x: number; y: number }>();
  private listeners = new Set<() => void>();
  keyDown(code: string) { if (code in KEY_BINDINGS) this.keys.add(code); }
  keyUp(code: string) { this.keys.delete(code); }
  setStick(side: 'left' | 'right', x: number, y: number) { this.sticks.set(side, { x, y }); }
  releaseStick(side: 'left' | 'right') { this.sticks.delete(side); }
  subscribeClear(listener: () => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  clear() { this.keys.clear(); this.sticks.clear(); this.listeners.forEach(listener => listener()); }
  sample(): ControlInput {
    const result = neutralInput();
    for (const code of this.keys) for (const [axis, value] of Object.entries(KEY_BINDINGS[code])) result[axis as keyof ControlInput] += value;
    const left = this.sticks.get('left'), right = this.sticks.get('right');
    if (left) { result.vertical += -left.y; result.yaw += left.x; }
    if (right) { result.forward += -right.y; result.right += right.x; }
    for (const axis of Object.keys(result) as (keyof ControlInput)[]) result[axis] = Number.isFinite(result[axis]) ? Math.max(-1, Math.min(1, result[axis])) : 0;
    return result;
  }
}
/** Radial clamp with rescaled 12% dead zone to avoid thumb jitter. */
export function stickVector(x: number, y: number, radius: number) {
  if (![x, y, radius].every(Number.isFinite) || radius <= 0) return { x: 0, y: 0 };
  const distance = Math.hypot(x, y), magnitude = Math.min(1, distance / radius);
  if (magnitude <= 0.12) return { x: 0, y: 0 };
  const strength = (magnitude - 0.12) / 0.88;
  return { x: x / distance * strength, y: y / distance * strength };
}
