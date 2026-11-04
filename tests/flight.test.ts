import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { FlightModel, neutralInput, LIMITS, type ControlInput } from '../src/core/flight';
import { bodyToWorld, toScene } from '../src/core/coordinates';
import { launch } from './flight-helpers';
const run=(m:FlightModel,seconds:number,input:ControlInput=neutralInput(),fps=60)=>{for(let i=0;i<seconds*fps;i++)m.update(1/fps,input);};
const airborne=()=>launch(new FlightModel());
describe('flight model',()=>{
  it('manually takes off and lands without penetrating ground, then disarms',()=>{const m=airborne();assert.equal(m.state.mode,'flying');assert.ok(m.state.position.up>2&&m.state.position.up<3);m.land();run(m,10);assert.equal(m.state.mode,'armed');assert.equal(m.state.position.up,0);assert.equal(m.disarm(),true);assert.equal(m.state.mode,'grounded');});
  it('matches 30,60,144 FPS trajectories',()=>{const states=[30,60,144].map(fps=>{const m=airborne();run(m,3,{...neutralInput(),forward:1,yaw:0.3},fps);return m.state;});for(const s of states){assert.ok(Math.abs(s.position.east-states[0].position.east)<1e-8);assert.ok(Math.abs(s.position.north-states[0].position.north)<1e-8);}});
  it('brakes to stable hover after release',()=>{const m=airborne();run(m,2,{...neutralInput(),forward:1});run(m,3);assert.ok(Math.hypot(m.state.velocity.east,m.state.velocity.north)<0.1);const p={...m.state.position};run(m,5);assert.ok(Math.hypot(m.state.position.east-p.east,m.state.position.north-p.north)<0.1);assert.ok(Math.abs(m.state.velocity.north)<0.02);});
  it('limits diagonal speed and acceleration',()=>{const m=airborne();m.update(1/60,{forward:1,right:1,vertical:0,yaw:0});assert.ok(Math.hypot(m.state.velocity.east,m.state.velocity.north)<=3/60+1e-9);run(m,3,{forward:1,right:1,vertical:0,yaw:0});assert.ok(Math.hypot(m.state.velocity.east,m.state.velocity.north)<=LIMITS.maxSpeed+1e-9);});
  it('clamps all horizontal and altitude boundaries',()=>{for(const sign of [-1,1]){const m=airborne();run(m,30,{forward:sign,right:sign,vertical:1,yaw:0});assert.equal(m.state.position.up,LIMITS.maxAltitude);assert.ok(Math.abs(Math.hypot(m.state.position.east,m.state.position.north)-LIMITS.radius)<1e-6);run(m,30,{...neutralInput(),vertical:-1});assert.equal(m.state.position.up,0);}});
  it('uses body-relative translation and clockwise heading',()=>{const m=airborne();run(m,2,{...neutralInput(),yaw:1});assert.ok(m.state.heading>0&&m.state.heading<360);const east=bodyToWorld(1,0,90);assert.ok(Math.abs(east.east-1)<1e-10);assert.ok(Math.abs(east.north)<1e-10);assert.deepEqual(toScene({east:1,north:2,up:3}),[1,3,-2]);});
  it('resets motion and rejects invalid delta/input',()=>{const m=airborne();m.update(NaN,neutralInput());run(m,1,{forward:NaN,right:Infinity,vertical:NaN,yaw:Infinity});assert.ok(Number.isFinite(m.state.position.east));m.reset();assert.equal(m.state.mode,'grounded');assert.equal(m.state.heading,0);});
  it('supports both directions of each independent axis',()=>{
    for(const sign of [-1,1]) {
      const forward=airborne();run(forward,1,{...neutralInput(),forward:sign});assert.ok(forward.state.position.north*sign>0);
      const strafe=airborne();run(strafe,1,{...neutralInput(),right:sign});assert.ok(strafe.state.position.east*sign>0);
      const vertical=airborne();const initialHeight=vertical.state.position.up;run(vertical,0.5,{...neutralInput(),vertical:sign});assert.ok((vertical.state.position.up-initialHeight)*sign>0);
      const yaw=airborne();run(yaw,1,{...neutralInput(),yaw:sign});assert.ok(sign===1?yaw.state.heading<180:yaw.state.heading>180);
    }
  });
});

