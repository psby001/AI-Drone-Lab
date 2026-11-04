import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { GamepadController, mapGamepad, describePad, type PadDevice } from '../src/input/GamepadController';
import { neutralInput, FlightModel } from '../src/core/flight';
import { launch } from './flight-helpers';
const pad = (index = 0, id = 'Xbox Wireless Controller', axes = [0, 0, 0, 0]): PadDevice => ({ index, id, axes, connected: true, mapping: 'standard' });
const ps5 = () => pad(2, 'DualSense Wireless Controller (Vendor: 054c Product: 0ce6)');

describe('physical gamepad ownership and mapping', () => {
  it('allows a centred selected gamepad to launch manually after Arm', () => {
    const m=new FlightModel(), c=new GamepadController(); c.poll([ps5()],false);c.select(2);
    m.arm();c.poll([ps5()],true);assert.equal(c.snapshot.status,'ready');
    const climb={...ps5(),axes:[0,-0.7,0,0]};
    for(let i=0;i<120;i++)m.update(1/120,c.poll([climb],true));
    assert.equal(m.state.mode,'flying');assert.ok(m.state.position.up>0);
    c.suspend();c.poll([climb],true);assert.equal(c.snapshot.status,'waiting');
    m.reset();assert.equal(m.state.mode,'grounded');assert.equal(m.state.thrust,0);
  });
  it('lists Xbox/PS5, preserves sparse indices and uses standard Mode 2 axes', () => {
    const c = new GamepadController(); c.poll([pad(), null, ps5()], true);
    assert.equal(c.snapshot.devices.length, 2); assert.match(c.snapshot.devices[1].name, /PS5/);
    for (const id of [pad().id, ps5().id]) {
      const input = mapGamepad(pad(0, id, [0, -1, 1, 0]));
      assert.deepEqual(input, { vertical: 1, yaw: 0, forward: 0, right: 1 });
      assert.deepEqual(mapGamepad(pad(0, id, [-1, 0, 0, 1])), { vertical: 0, yaw: -1, forward: -1, right: 0 });
    }
  });
  it('only reads the explicitly selected device and requires neutral before arming', () => {
    const c = new GamepadController(); const xbox = pad(0, undefined, [1, 0, 0, 0]), sony = ps5();
    c.poll([xbox, null, sony], true); assert.deepEqual(c.input, neutralInput());
    c.select(2); c.poll([xbox, null, { ...sony, axes: [0, -1, 0, 0] }], true);
    assert.equal(c.snapshot.status, 'waiting'); assert.deepEqual(c.input, neutralInput());
    c.poll([xbox, null, sony], true); assert.equal(c.snapshot.status, 'ready');
    c.poll([xbox, null, { ...sony, axes: [0, -1, 0, 0] }], true);
    assert.equal(c.input.vertical, 1); assert.equal(c.input.yaw, 0);
    c.select(0); assert.deepEqual(c.input, neutralInput());
    c.poll([xbox, null, sony], true); assert.equal(c.snapshot.status, 'waiting');
  });
  it('filters stick drift and clamps diagonal magnitude', () => {
    assert.deepEqual(mapGamepad(pad(0, undefined, [0.03, -0.04, 0.01, 0])), neutralInput());
    const input = mapGamepad(pad(0, undefined, [1, -1, -1, 1]));
    assert.ok(Math.abs(Math.hypot(input.vertical, input.yaw)-1)<1e-10);
    assert.ok(Math.abs(Math.hypot(input.forward, input.right)-1)<1e-10);
  });
  it('disconnects safely and does not select another/reconnected device automatically', () => {
    const c = new GamepadController(); c.poll([pad(), null, ps5()], true); c.select(2);
    c.poll([pad(), null, ps5()], true); c.poll([pad(), null, { ...ps5(), axes: [1, 0, 0, 0] }], true);
    assert.equal(c.input.yaw, 1); c.poll([pad(), null, null], true);
    assert.equal(c.snapshot.selected, null); assert.equal(c.snapshot.status, 'disconnected'); assert.deepEqual(c.input, neutralInput());
    c.poll([pad(), null, ps5()], true); assert.equal(c.snapshot.selected, null);
    c.select(2); c.disconnect(2); c.poll([pad(), null, ps5()], true); assert.equal(c.snapshot.selected, null);
  });
  it('rejects index reuse, nonstandard layouts and nonfinite readings', () => {
    const c = new GamepadController(); c.poll([pad()], true); c.select(0); c.poll([pad()], true);
    c.poll([pad(0, 'Different controller')], true); assert.equal(c.snapshot.selected, null);
    const raw = { ...pad(), mapping: '' }; c.poll([raw], true); assert.equal(describePad(raw).supported, false);
    c.select(0); assert.equal(c.snapshot.selected, null);
    c.poll([pad()], true); c.select(0); c.poll([pad()], true);
    c.poll([pad(0, undefined, [NaN, 0, 0, 0])], true); assert.deepEqual(c.input, neutralInput()); assert.equal(c.snapshot.status, 'waiting');
  });
  it('focus/pause/hover and reset require a fresh neutral reading', () => {
    const c = new GamepadController(); c.poll([pad()], true); c.select(0); c.poll([pad()], true);
    const moving = pad(0, undefined, [0, -1, 0, -1]); c.poll([moving], true); assert.equal(c.input.forward, 1);
    c.poll([moving], false); assert.deepEqual(c.input, neutralInput());
    c.poll([moving], true); assert.equal(c.snapshot.status, 'waiting');
    c.poll([pad()], true); c.poll([moving], true); assert.equal(c.input.forward, 1);
    c.suspend(); assert.deepEqual(c.input, neutralInput()); c.poll([moving], true); assert.equal(c.snapshot.status, 'waiting');
    c.unavailable(); assert.equal(c.snapshot.selected, null); assert.deepEqual(c.input, neutralInput());
  });
  it('drives the existing physics model and brakes when disconnected', () => {
    const c = new GamepadController(), m = launch(new FlightModel());
    c.poll([ps5()], true); c.select(2); c.poll([ps5()], true);
    for (let i = 0; i < 120; i++) m.update(1/120, c.poll([{ ...ps5(), axes: [0, -0.6, 0, -0.6] }], true));
    assert.ok(m.state.position.up>2 && m.state.position.north>0);
    c.poll([], true); for (let i=0;i<960;i++) m.update(1/120,c.input);
    assert.ok(Math.hypot(m.state.velocity.east,m.state.velocity.north,m.state.velocity.up)<0.02);
  });
});
