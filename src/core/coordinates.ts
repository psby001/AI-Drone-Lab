export interface Vec3 { east: number; north: number; up: number }
export const radians = (degrees: number) => degrees * Math.PI / 180;
export const degrees = (radians: number) => radians * 180 / Math.PI;
export const normalizeHeading = (angle: number) => ((angle % 360) + 360) % 360;
// ENU world -> Three.js: +X east, +Y up, -Z north.
export const toScene = (v: Vec3): [number, number, number] => [v.east, v.up, -v.north];
// Body +forward, +right, +up; heading north=0, clockwise positive.
export function bodyToWorld(forward: number, right: number, heading: number) {
  const h = radians(heading);
  return { east: forward * Math.sin(h) + right * Math.cos(h), north: forward * Math.cos(h) - right * Math.sin(h) };
}
