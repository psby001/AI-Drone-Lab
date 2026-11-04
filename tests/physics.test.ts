import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { FlightModel, neutralInput, LIMITS, type ControlInput } from '../src/core/flight';
import { dragAcceleration, PHYSICS } from '../src/core/environment';
import { radians, toScene } from '../src/core/coordinates';
import { launch } from './flight-helpers';
const run = (m: FlightModel, seconds: number, input: ControlInput = neutralInput(), fps = 120) => {
  for (let i = 0; i < seconds * fps; i++) m.update(1 / fps, input);
};
const airborne = () => launch(new FlightModel());
describe('attitude, thrust and wind', () => {
  it('leans in each acceleration direction and reverses pitch to brake', () => {
    for (const sign of [-1, 1]) {
      const forward = airborne(); run(forward, 0.7, { ...neutralInput(), forward: sign });
      assert.ok(forward.state.attitude.pitch * sign > 8);
      assert.ok(forward.state.acceleration.north * sign > 0);
      const lateral = airborne(); run(lateral, 0.7, { ...neutralInput(), right: sign });
      assert.ok(lateral.state.attitude.roll * sign > 8);
      assert.ok(lateral.state.acceleration.east * sign > 0);
    }
    const m = airborne(); run(m, 2, { ...neutralInput(), forward: 1 }); run(m, 0.7);
    assert.ok(m.state.attitude.pitch < -8); assert.ok(m.state.acceleration.north < 0);
    run(m, 15); assert.ok(Math.abs(m.state.attitude.pitch) < 0.05);
  });
  it('rendered body up vector matches the thrust acceleration at any heading', () => {
    for (const heading of [0, 90, 180, 270]) {
      const m = airborne(); m.state.heading = heading; run(m, 0.7, { forward: 0.8, right: 0.6, vertical: 0, yaw: 0 });
      const s = m.state;
      const yaw = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -radians(s.heading));
      const tilt = new THREE.Quaternion().setFromEuler(new THREE.Euler(-radians(s.attitude.pitch), 0, -radians(s.attitude.roll)));
      const rendered = new THREE.Vector3(0, 1, 0).applyQuaternion(yaw.multiply(tilt)).multiplyScalar(s.thrust / PHYSICS.mass);
      const drag = dragAcceleration(s.velocity, s.wind);
      const force = new THREE.Vector3(...toScene({ east: s.acceleration.east - drag.east, north: s.acceleration.north - drag.north, up: s.acceleration.up + PHYSICS.gravity - drag.up }));
      // State velocity is integrated after acceleration; drag differs by one 1/120s step.
      assert.ok(rendered.distanceTo(force) < 0.02);
      assert.ok(Math.abs(s.attitude.pitch) <= 25 && Math.abs(s.attitude.roll) <= 25);
    }
  });
  it('uses quadratic air-relative drag, not a positional wind offset', () => {
    const z = { east: 0, north: 0, up: 0 };
    const a = dragAcceleration(z, { ...z, east: 2 }), b = dragAcceleration(z, { ...z, east: 4 });
    assert.ok(Math.abs(b.east / a.east - 4) < 1e-10);
    assert.deepEqual(dragAcceleration({ ...z, east: 3 }, { ...z, east: 3 }), z);
    assert.ok(dragAcceleration({ ...z, north: 2 }, z).north < 0);
  });
  it('wind creates drift and counter-lean; ground stays still', () => {
    const m = airborne(); m.setEnvironment('strong', 90); run(m, 1);
    assert.ok(m.state.position.east > 0.0001);
    run(m, 15); assert.ok(m.state.attitude.roll < -0.1);
    assert.ok(Math.hypot(m.state.position.east, m.state.position.north) < 0.5);
    assert.ok(Math.hypot(m.state.velocity.east,m.state.velocity.north) < 0.25);
    const ground = new FlightModel('strong'); run(ground, 60);
    assert.deepEqual(ground.state.position, { east: 0, north: 0, up: 0 });
    assert.deepEqual(ground.state.attitude, { pitch: 0, roll: 0 });
  });
  it('gusty flight is deterministic across 30/60/144 FPS', () => {
    const states = [30, 60, 144].map(fps => {
      const m = launch(new FlightModel('strong'), fps);
      run(m, 2, { forward: 0.5, right: 0.2, vertical: 0.2, yaw: 0.3 }, fps); return m.state;
    });
    for (const s of states) for (const axis of ['east', 'north', 'up'] as const) assert.ok(Math.abs(s.position[axis] - states[0].position[axis]) < 1e-8);
  });
  it('holds altitude, lands and respects boundaries in strong wind', () => {
    const m = launch(new FlightModel('strong')); assert.equal(m.state.mode, 'flying');
    run(m, 12, { ...neutralInput(), vertical: 1 }); assert.equal(m.state.position.up, LIMITS.maxAltitude);
    const before = { ...m.state.position }; run(m, 30);
    assert.ok(Math.abs(m.state.position.up - LIMITS.maxAltitude) < 0.05);
    assert.ok(Math.hypot(m.state.position.east-before.east,m.state.position.north-before.north)<1.5);
    run(m, 30, { forward: -1, right: 1, vertical: 0, yaw: 0 });
    assert.ok(Math.hypot(m.state.position.east,m.state.position.north)<=LIMITS.radius+1e-8);
    m.land(); run(m, 30); assert.equal(m.state.mode, 'armed'); assert.equal(m.state.position.up, 0); m.disarm(); assert.equal(m.state.mode,'grounded');
    assert.deepEqual(m.state.attitude, { pitch: 0, roll: 0 });
    m.reset(); assert.equal(m.environment.preset, 'strong'); assert.deepEqual(m.state.wind, { east: 0, north: 0, up: 0 });
  });
  it('can take off after waiting on the ground at different gust phases', () => {
    for (const wait of [1, 5, 15, 30, 60]) {
      const m = new FlightModel('strong'); run(m, wait); launch(m);
      assert.equal(m.state.mode, 'flying', `wait=${wait}`);
      assert.ok(m.state.position.up>2&&m.state.position.up<3);
    }
  });
});

