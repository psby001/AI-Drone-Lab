import { bodyToWorld, type Vec3 } from './coordinates';

export const WIND_PRESETS = {
  calm: { label: '無風', speed: 0, gust: 0 },
  breeze: { label: '微風', speed: 2.5, gust: 1 },
  strong: { label: '強風', speed: 5, gust: 2 },
} as const;
export type WindPreset = keyof typeof WIND_PRESETS;
export interface EnvironmentSettings { preset: WindPreset; direction: number }

/** ENU wind velocity (m/s). Direction is where the wind blows TO, not FROM.
 * Continuous deterministic gusts avoid frame-rate-dependent random forces.
 */
export function windTarget(settings: EnvironmentSettings, time: number, altitude: number): Vec3 {
  const { speed, gust } = WIND_PRESETS[settings.preset];
  const shear = 0.35 + 0.65 * Math.min(1, Math.max(0, altitude) / 8);
  const pulse = gust * (0.6 * Math.sin(time * 0.73) + 0.4 * Math.sin(time * 1.91));
  const cross = gust * 0.35 * Math.sin(time * 1.17);
  const horizontal = bodyToWorld(Math.max(0, speed + pulse) * shear, cross * shear, settings.direction);
  return { ...horizontal, up: gust * 0.14 * Math.sin(time * 1.43) * shear };
}

export const PHYSICS = {
  gravity: 9.81, mass: 1, airDensity: 1.225, dragArea: 0.085,
  maxTilt: 25, attitudeResponse: 0.22, maxThrustRatio: 2.2,
} as const;

/** Quadratic drag per kg, based on air-relative velocity. */
export function dragAcceleration(velocity: Vec3, wind: Vec3): Vec3 {
  const e = wind.east - velocity.east, n = wind.north - velocity.north, u = wind.up - velocity.up;
  const factor = 0.5 * PHYSICS.airDensity * PHYSICS.dragArea / PHYSICS.mass * Math.hypot(e, n, u);
  return { east: e * factor, north: n * factor, up: u * factor };
}
