import { bodyToWorld, degrees, normalizeHeading, radians, type Vec3 } from './coordinates';
import { dragAcceleration, PHYSICS, WIND_PRESETS, windTarget, type EnvironmentSettings, type WindPreset } from './environment';
import { LIMITS, SCENE_LIMITS } from '../config/limits';
export { LIMITS } from '../config/limits';
export type FlightMode = 'grounded' | 'armed' | 'flying' | 'landing';
export type ControlMode = 'position' | 'attitude';
export interface FlightState {
  position: Vec3; velocity: Vec3; acceleration: Vec3;
  heading: number; yawRate: number; mode: FlightMode; boundary: boolean;
  controlMode: ControlMode;
  /** Degrees: pitch positive nose down, roll positive right side down. */
  attitude: { pitch: number; roll: number };
  wind: Vec3; thrust: number; airspeed: number;
}
export interface ControlInput { forward: number; right: number; vertical: number; yaw: number }
export const neutralInput = (): ControlInput => ({ forward: 0, right: 0, vertical: 0, yaw: 0 });
const zero = (): Vec3 => ({ east: 0, north: 0, up: 0 });
export const initialState = (): FlightState => ({ position: zero(), velocity: zero(), acceleration: zero(), heading: 0, yawRate: 0, mode: 'grounded', controlMode: 'position', boundary: false, attitude: { pitch: 0, roll: 0 }, wind: zero(), thrust: 0, airspeed: 0 });
const clamp = (v: number, low = -1, high = 1) => Math.max(low, Math.min(high, v));
const approach = (a: number, b: number, step: number) => a + clamp(b - a, -step, step);

/** Shared multirotor dynamics. Horizontal input requests velocity in position
 * mode, tilt in attitude mode. Independent of keyboard, renderer or AI. */
export class FlightModel {
  state = initialState();
  flightBounds={radius:Number(LIMITS.radius),maxAltitude:Number(LIMITS.maxAltitude)};
  setFlightBounds(bounds={radius:Number(LIMITS.radius),maxAltitude:Number(LIMITS.maxAltitude)}){
    if(!Number.isFinite(bounds.radius)||bounds.radius<=0||bounds.radius>SCENE_LIMITS.maxRadius||!Number.isFinite(bounds.maxAltitude)||bounds.maxAltitude<.5||bounds.maxAltitude>SCENE_LIMITS.maxAltitude)throw new Error('場景邊界超出全域安全限制');
    this.flightBounds={...bounds};
  }
  containsPosition(p:Vec3){return Math.hypot(p.east,p.north)<=this.flightBounds.radius+1e-8&&p.up>=0&&p.up<=this.flightBounds.maxAltitude+1e-8;}

  environment: EnvironmentSettings;
  private accumulator = 0;
  private time = 0;
  get simulationTime(){return this.time;}
  private hold = zero();
  private integral = zero();
  private wasMoving = false;
  private braking = false;
  private brakingTime = 0;
  private wasVertical = false;
  constructor(preset: WindPreset = 'calm') { this.environment = { preset, direction: 90 }; }
  setEnvironment(preset: WindPreset, direction = this.environment.direction) {
    if (!(preset in WIND_PRESETS) || !Number.isFinite(direction)) return;
    this.environment = { preset, direction: normalizeHeading(direction) };
  }
  reset(spawn?:{position:Vec3;heading:number}) {
    this.state = initialState(); this.accumulator = 0; this.time = 0;
    if(spawn){
      const p=spawn.position;
      if(![p.east,p.north,p.up,spawn.heading].every(Number.isFinite)||p.up!==0||Math.hypot(p.east,p.north)>this.flightBounds.radius)throw new Error('無效的地面出生點');
      this.state.position={...p};this.state.heading=normalizeHeading(spawn.heading);
    }
    this.hold = zero(); this.integral = zero(); this.wasMoving = false; this.wasVertical = false; this.braking = false;
  }
  arm(): boolean {
    if (this.state.mode !== 'grounded') return false;
    this.state.mode = 'armed'; this.hold = { ...this.state.position }; this.integral = zero();
    this.wasMoving = false; this.wasVertical = false; this.braking = false;
    return true;
  }
  disarm(): boolean {
    // Stop motors only after touching down. No mid-air reset or teleportation.
    if (this.state.mode !== 'armed' && this.state.mode !== 'grounded') return false;
    this.state.mode = 'grounded'; this.state.thrust = 0; return true;
  }
  setControlMode(mode: ControlMode): boolean {
    if ((mode !== 'position' && mode !== 'attitude') || this.state.mode === 'landing') return false;
    if (this.state.controlMode === mode) return true;
    this.state.controlMode = mode; this.hold = { ...this.state.position }; this.integral = zero();
    this.wasMoving = false; this.wasVertical = false; this.brakingTime = 0;
    this.braking = mode === 'position' && Math.hypot(this.state.velocity.east, this.state.velocity.north) > 0.12;
    return true;
  }
  land() {
    if (this.state.mode !== 'flying') return;
    this.state.mode = 'landing'; this.hold = { ...this.state.position };
    this.wasMoving = false; this.wasVertical = false; this.braking = false;
  }
  /** Autopilot command: cancel an automatic descent and brake/hold the current
   * position. This changes controller targets, never aircraft position. */
  holdPosition() {
    if (this.state.mode === 'landing') this.state.mode = 'flying';
    this.state.controlMode = 'position'; this.hold = { ...this.state.position };
    this.integral = zero(); this.wasMoving = false; this.wasVertical = false;
    this.brakingTime = 0;
    this.braking = Math.hypot(this.state.velocity.east, this.state.velocity.north) > 0.12;
  }
  update(delta: number, input: ControlInput) {
    if (!Number.isFinite(delta) || delta <= 0) return;
    this.accumulator += Math.min(delta, 0.1);
    while (this.accumulator >= 1 / 120 - 1e-10) { this.step(1 / 120, input); this.accumulator -= 1 / 120; }
  }
  private step(dt: number, input: ControlInput) {
    const s = this.state; s.boundary = false; this.time += dt;
    const targetWind = windTarget(this.environment, this.time, s.position.up);
    for (const axis of ['east', 'north', 'up'] as const) s.wind[axis] += (targetWind[axis] - s.wind[axis]) * (1 - Math.exp(-dt / 1.2));
    if (s.mode === 'grounded') { s.acceleration = zero(); s.thrust = 0; s.airspeed = Math.hypot(s.wind.east, s.wind.north, s.wind.up); return; }
    const safe = (v: number) => Number.isFinite(v) ? clamp(v) : 0;
    if (s.mode === 'armed') {
      s.acceleration = zero(); s.velocity = zero(); s.attitude = { pitch: 0, roll: 0 };
      s.thrust = PHYSICS.mass * PHYSICS.gravity * 0.08;
      s.airspeed = Math.hypot(s.wind.east, s.wind.north, s.wind.up);
      // Motors idle on the ground until the student gives a positive climb command.
      if (safe(input.vertical) <= 0.05) return;
      s.mode = 'flying'; this.hold = { ...s.position };
    }
    const manual = s.mode === 'flying';
    const positionAssisted = s.controlMode === 'position' || s.mode === 'landing';
    let forward = manual ? safe(input.forward) : 0, right = manual ? safe(input.right) : 0;
    const length = Math.max(1, Math.hypot(forward, right)); forward /= length; right /= length;
    const moving = Math.hypot(forward, right) > 0.001;
    const desired = bodyToWorld(forward * LIMITS.maxSpeed, right * LIMITS.maxSpeed, s.heading);
    if (positionAssisted && moving) {
      this.hold.east = s.position.east; this.hold.north = s.position.north;
      this.integral.east = 0; this.integral.north = 0;
      this.braking = false;
    } else if (positionAssisted && this.wasMoving) {
      this.braking = true; this.brakingTime = 0;
    }
    if (positionAssisted && this.braking) {
      // Brake velocity first; only capture a position once almost stopped.
      this.hold.east = s.position.east; this.hold.north = s.position.north;
      this.brakingTime += dt;
      if (Math.hypot(s.velocity.east, s.velocity.north) < 0.12 || this.brakingTime > 2.8) this.braking = false;
    }
    this.wasMoving = moving;
    const stillAirDrag = dragAcceleration(s.velocity, zero());
    let ae = 0, an = 0;
    if (positionAssisted) for (const axis of ['east', 'north'] as const) {
      const error = this.hold[axis] - s.position[axis];
      if (!moving && !this.braking) this.integral[axis] = clamp(this.integral[axis] + error * dt * 0.7, -2, 2);
      const acceleration = moving || this.braking
        ? (desired[axis] - s.velocity[axis]) * 2.4 - stillAirDrag[axis]
        : error * 1.8 - s.velocity[axis] * 2.4 + this.integral[axis];
      if (axis === 'east') ae = acceleration; else an = acceleration;
    }
    const factor = Math.min(1, LIMITS.acceleration / (Math.hypot(ae, an) || 1)); ae *= factor; an *= factor;

    const verticalInput = manual ? safe(input.vertical) : 0;
    const verticalMoving = Math.abs(verticalInput) > 0.001;
    if (verticalMoving) this.hold.up = s.position.up;
    else if (this.wasVertical) this.hold.up = clamp(s.position.up + s.velocity.up / 3, 0, this.flightBounds.maxAltitude);
    this.wasVertical = verticalMoving;
    let desiredUp = verticalMoving ? verticalInput * LIMITS.verticalSpeed : clamp((this.hold.up - s.position.up) * 1.8, -2, 2);
    if (s.mode === 'landing') desiredUp = -Math.min(1.2, Math.max(0.25, s.position.up * 1.5));
    const au = clamp((desiredUp - s.velocity.up) * 4, -3, 3);

    // Rotate world acceleration into body frame. Attitude lags commands.
    const h = radians(s.heading), af = ae * Math.sin(h) + an * Math.cos(h), ar = ae * Math.cos(h) - an * Math.sin(h);
    const targetPitch = positionAssisted ? clamp(degrees(Math.atan2(af, PHYSICS.gravity + au)), -PHYSICS.maxTilt, PHYSICS.maxTilt) : forward * PHYSICS.maxTilt;
    const targetRoll = positionAssisted ? clamp(degrees(Math.atan2(ar * Math.cos(radians(targetPitch)), PHYSICS.gravity + au)), -PHYSICS.maxTilt, PHYSICS.maxTilt) : right * PHYSICS.maxTilt;
    const response = 1 - Math.exp(-dt / PHYSICS.attitudeResponse);
    // Settle the landing gear upright before contacting the ground.
    const groundBlend = clamp(s.position.up / 0.45, 0, 1);
    s.attitude.pitch += (targetPitch * groundBlend - s.attitude.pitch) * response;
    s.attitude.roll += (targetRoll * groundBlend - s.attitude.roll) * response;
    const pitch = radians(s.attitude.pitch), roll = radians(s.attitude.roll);
    const verticalProjection = Math.cos(pitch) * Math.cos(roll);
    s.thrust = clamp(PHYSICS.mass * (PHYSICS.gravity + au - stillAirDrag.up) / verticalProjection, 0, PHYSICS.mass * PHYSICS.gravity * PHYSICS.maxThrustRatio);
    const thrust = s.thrust / PHYSICS.mass;
    const horizontalThrust = bodyToWorld(thrust * Math.sin(pitch) * Math.cos(roll), thrust * Math.sin(roll), s.heading);
    const drag = dragAcceleration(s.velocity, s.wind);
    s.acceleration = { east: horizontalThrust.east + drag.east, north: horizontalThrust.north + drag.north, up: thrust * verticalProjection - PHYSICS.gravity + drag.up };
    for (const axis of ['east', 'north', 'up'] as const) s.velocity[axis] += s.acceleration[axis] * dt;
    // Pedagogical geofence and speed governor remain active under gusts.
    const horizontalSpeed = Math.hypot(s.velocity.east, s.velocity.north);
    const speedLimit = positionAssisted ? LIMITS.maxSpeed : LIMITS.attitudeMaxSpeed;
    if (horizontalSpeed > speedLimit) { s.velocity.east *= speedLimit / horizontalSpeed; s.velocity.north *= speedLimit / horizontalSpeed; }
    s.velocity.up = clamp(s.velocity.up, -LIMITS.verticalSpeed, LIMITS.verticalSpeed);
    s.yawRate = approach(s.yawRate, manual ? safe(input.yaw) * LIMITS.yawSpeed : 0, 180 * dt);
    s.heading = normalizeHeading(s.heading + s.yawRate * dt);
    for (const axis of ['east', 'north', 'up'] as const) s.position[axis] += s.velocity[axis] * dt;
    const radialDistance = Math.hypot(s.position.east, s.position.north);
    if (radialDistance > this.flightBounds.radius) {
      s.position.east *= this.flightBounds.radius / radialDistance; s.position.north *= this.flightBounds.radius / radialDistance;
      s.velocity.east = 0; s.velocity.north = 0; this.integral.east = 0; this.integral.north = 0; s.boundary = true;
    }
    if (s.position.up >= this.flightBounds.maxAltitude) { s.position.up = this.flightBounds.maxAltitude; s.velocity.up = Math.min(0, s.velocity.up); s.boundary = true; }
    if (s.position.up <= 0) { s.position.up = 0; s.velocity = zero(); s.acceleration = zero(); s.attitude = { pitch: 0, roll: 0 }; s.yawRate = 0; s.thrust = PHYSICS.mass * PHYSICS.gravity * 0.08; s.mode = 'armed'; this.integral = zero(); this.hold = { ...s.position }; this.wasMoving = false; this.wasVertical = false; this.braking = false; }
    s.airspeed = Math.hypot(s.velocity.east - s.wind.east, s.velocity.north - s.wind.north, s.velocity.up - s.wind.up);
  }
}
