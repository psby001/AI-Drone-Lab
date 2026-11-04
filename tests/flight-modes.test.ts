import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { FlightModel, neutralInput, LIMITS } from '../src/core/flight';
import { advance, launch } from './flight-helpers';

describe('arm/disarm and assisted flight modes', () => {
  it('ignores movement while disarmed; Arm spins idle without takeoff or ground drift', () => {
    const m = new FlightModel('strong');
    advance(m, 2, { forward: 1, right: 1, vertical: 1, yaw: 1 });
    assert.equal(m.state.mode, 'grounded'); assert.equal(m.state.thrust, 0);
    assert.deepEqual(m.state.position, { east: 0, north: 0, up: 0 });
    assert.equal(m.arm(), true); advance(m, 15);
    assert.equal(m.state.mode, 'armed'); assert.ok(m.state.thrust>0);
    assert.deepEqual(m.state.position, { east: 0, north: 0, up: 0 });
    advance(m, 1, { ...neutralInput(), right: 1, yaw: 1 });
    assert.equal(m.state.position.east, 0); assert.equal(m.state.heading, 0);
    assert.equal(m.disarm(), true); assert.equal(m.state.thrust,0);
  });
  it('student climb input takes off, release holds chosen altitude and Disarm is rejected in air', () => {
    const m = new FlightModel(); m.arm(); advance(m, 1, { ...neutralInput(), vertical: 0.6 });
    assert.equal(m.state.mode, 'flying'); assert.ok(m.state.position.up>0);
    assert.equal(m.disarm(), false); assert.equal(m.state.mode, 'flying');
    advance(m, 8); const height=m.state.position.up; advance(m, 5);
    assert.ok(Math.abs(m.state.position.up-height)<0.01);
    assert.ok(height>0.5&&height<2); // No forced 2m takeoff target.
    advance(m, 8, { ...neutralInput(), vertical: -1 });
    assert.equal(m.state.mode,'armed'); assert.equal(m.state.position.up,0);
    assert.ok(m.state.thrust>0); m.disarm(); assert.equal(m.state.mode,'grounded');
  });
  it('attitude mode retains inertia after release; position mode brakes', () => {
    const position=launch(new FlightModel()), attitude=launch(new FlightModel());
    attitude.setControlMode('attitude');
    for (const m of [position,attitude]) advance(m, 1, { ...neutralInput(), forward: 0.8 });
    const p0=position.state.position.north, a0=attitude.state.position.north;
    for (const m of [position,attitude]) advance(m,3);
    assert.ok(Math.abs(position.state.velocity.north)<0.15);
    assert.ok(attitude.state.velocity.north>1);
    assert.ok(attitude.state.position.north-a0 > position.state.position.north-p0+1);
    assert.ok(Math.abs(attitude.state.attitude.pitch)<0.01);
  });
  it('wind drifts a level attitude-mode drone while position mode counters wind', () => {
    const p=launch(new FlightModel()), a=launch(new FlightModel()); a.setControlMode('attitude');
    for(const m of [p,a]) { m.setEnvironment('strong',90); advance(m,12); }
    assert.ok(a.state.position.east>2); assert.ok(Math.abs(p.state.position.east)<0.5);
    assert.equal(a.state.attitude.roll,0); assert.ok(p.state.attitude.roll<0);
    assert.ok(Math.abs(a.state.velocity.up)<0.05);
  });
  it('switching preserves motion and pose; switching back brakes near current location', () => {
    const m=launch(new FlightModel()); m.setControlMode('attitude'); advance(m,1,{...neutralInput(),right:0.7});
    const before=structuredClone(m.state); m.setControlMode('position');
    assert.deepEqual(m.state.position,before.position); assert.deepEqual(m.state.velocity,before.velocity); assert.deepEqual(m.state.attitude,before.attitude);
    advance(m,8); assert.ok(Math.hypot(m.state.velocity.east,m.state.velocity.north)<0.03);
    assert.ok(m.state.position.east>before.position.east); // No teleport back to old launch anchor.
  });
  it('landing assistance overrides attitude mode, keeps motors armed; reset stops motors', () => {
    const m=launch(new FlightModel('strong')); m.setControlMode('attitude');
    advance(m,1,{...neutralInput(),forward:0.5}); m.land(); assert.equal(m.setControlMode('position'),false);
    advance(m,15); assert.equal(m.state.mode,'armed'); assert.equal(m.state.controlMode,'attitude');
    assert.equal(m.state.position.up,0); assert.ok(m.state.thrust>0);
    m.reset(); assert.equal(m.state.mode,'grounded'); assert.equal(m.state.controlMode,'position'); assert.equal(m.state.thrust,0);
  });
  it('manual takeoff and attitude drift are FPS-independent and preserve safety limits', () => {
    const states=[30,60,144].map(fps=>{
      const m=launch(new FlightModel('strong'),fps); m.setControlMode('attitude');
      advance(m,1,{forward:0.6,right:-0.2,vertical:0,yaw:0.2},fps);advance(m,3,neutralInput(),fps);return m.state;
    });
    for(const s of states) for(const key of ['east','north','up'] as const) assert.ok(Math.abs(s.position[key]-states[0].position[key])<1e-8);
    const m=launch(new FlightModel('strong'));m.setControlMode('attitude');advance(m,30,{forward:1,right:1,vertical:1,yaw:0});
    assert.ok(Math.hypot(m.state.position.east,m.state.position.north)<=LIMITS.radius+1e-8&&m.state.position.up<=LIMITS.maxAltitude);
    assert.ok(Math.hypot(m.state.velocity.east,m.state.velocity.north)<=LIMITS.attitudeMaxSpeed+0.001);
  });
});

