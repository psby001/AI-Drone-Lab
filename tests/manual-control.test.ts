import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { KEY_BINDINGS, ManualController, stickVector } from '../src/input/ManualController';
import { FlightModel, neutralInput } from '../src/core/flight';
import { launch } from './flight-helpers';

describe('manual input adapter', () => {
  it('maps every requested keyboard direction', () => {
    const expected = { KeyW: ['vertical', 1], KeyS: ['vertical', -1], KeyQ: ['yaw', -1], KeyE: ['yaw', 1], ArrowUp: ['forward', 1], ArrowDown: ['forward', -1], ArrowLeft: ['right', -1], ArrowRight: ['right', 1] } as const;
    assert.equal(Object.keys(KEY_BINDINGS).length, 8);
    for (const [code, [axis, value]] of Object.entries(expected)) {
      const c = new ManualController(); c.keyDown(code); c.keyDown(code);
      assert.equal(c.sample()[axis], value); c.keyUp(code); assert.deepEqual(c.sample(), neutralInput());
    }
  });
  it('combines simultaneous height, yaw and horizontal keyboard input', () => {
    const c = new ManualController(); ['KeyW', 'KeyE', 'ArrowUp', 'ArrowRight'].forEach(k => c.keyDown(k));
    assert.deepEqual(c.sample(), { vertical: 1, yaw: 1, forward: 1, right: 1 });
    c.keyDown('KeyS'); assert.equal(c.sample().vertical, 0);
    c.keyUp('KeyS'); assert.equal(c.sample().vertical, 1);
  });
  it('keeps both Mode 2 sticks independent on release', () => {
    const c = new ManualController(); c.setStick('left', 0.5, -0.75); c.setStick('right', -0.4, -1);
    assert.deepEqual(c.sample(), { vertical: 0.75, yaw: 0.5, forward: 1, right: -0.4 });
    c.releaseStick('left'); assert.deepEqual(c.sample(), { vertical: 0, yaw: 0, forward: 1, right: -0.4 });
    c.releaseStick('right'); assert.deepEqual(c.sample(), neutralInput());
  });
  it('clamps combined sources and clears keys, sticks and thumb subscribers', () => {
    const c = new ManualController(); let cleared = 0;
    const unsubscribe = c.subscribeClear(() => cleared++);
    c.keyDown('KeyW'); c.setStick('left', 1, -1); assert.equal(c.sample().vertical, 1);
    c.clear(); assert.deepEqual(c.sample(), neutralInput()); assert.equal(cleared, 1);
    unsubscribe(); c.clear(); assert.equal(cleared, 1);
  });
  it('uses radial dead zone and proportional magnitude with no overshoot', () => {
    assert.deepEqual(stickVector(3, 2, 50), { x: 0, y: 0 });
    assert.equal(stickVector(50, 0, 50).x, 1);
    assert.ok(stickVector(25, 0, 50).x > 0 && stickVector(25, 0, 50).x < 1);
    const diagonal = stickVector(100, -100, 50); assert.ok(Math.abs(Math.hypot(diagonal.x, diagonal.y) - 1) < 1e-10);
    assert.deepEqual(stickVector(NaN, 0, 50), { x: 0, y: 0 });
  });
  it('drives the existing model with two sticks and settles into hover', () => {
    const m = new FlightModel(), c = new ManualController();
    launch(m);
    c.setStick('left', 0, -0.7); c.setStick('right', 0.2, -0.8);
    for (let i = 0; i < 120; i++) m.update(1 / 60, c.sample());
    assert.ok(m.state.position.up > 2); assert.ok(m.state.position.north > 0); assert.ok(m.state.position.east > 0);
    c.clear(); for (let i = 0; i < 180; i++) m.update(1 / 60, c.sample());
    assert.ok(Math.hypot(m.state.velocity.east,m.state.velocity.north,m.state.velocity.up)<0.1);
    const p = { ...m.state.position }; for (let i = 0; i < 120; i++) m.update(1 / 60, c.sample());
    assert.ok(Math.hypot(m.state.position.east-p.east,m.state.position.north-p.north,m.state.position.up-p.up)<0.1);
  });
});
