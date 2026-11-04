import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { FlightModel, neutralInput, LIMITS } from '../src/core/flight';
import { MissionRunner } from '../src/missions/MissionRunner';
import { PRESETS } from '../src/missions/presets';
import { validateMission } from '../src/missions/validate';
import { MISSION_LIMITS as M } from '../src/config/limits';
const run = (r: MissionRunner, seconds: number, fps = 60) => { for (let i=0;i<seconds*fps;i++) r.update(1/fps); };
const fixture = (id = 'square', wind: 'calm' | 'breeze' | 'strong' = 'calm') => {
  const model = new FlightModel(wind), runner = new MissionRunner(model);
  assert.deepEqual(runner.load(PRESETS.find(p=>p.id===id)!.mission),[]); assert.equal(runner.start(),true); return {model,runner};
};
describe('mission schema and semantics',()=>{
  it('compiles four presets and expands square to four moves and four turns',()=>{
    for(const preset of PRESETS) assert.deepEqual(validateMission(preset.mission).errors,[],preset.id);
    const plan=validateMission(PRESETS[2].mission).plan!;
    assert.equal(plan.steps.length,10);assert.equal(plan.steps.filter(s=>s.command.action==='move_forward').length,4);
    assert.equal(plan.steps.filter(s=>s.command.action==='turn_right').length,4);
    assert.ok(Math.hypot(plan.steps.at(-1)!.target.east,plan.steps.at(-1)!.target.north)<1e-8);
    assert.equal(plan.steps.at(-1)!.target.heading,360);
  });
  it('rejects malformed, unknown fields, missing/invalid numbers, loops and expanded overflow',()=>{
    const invalid: unknown[]=['{',{}, {commands:[{action:'fly'}]}, {commands:[{action:'takeoff',altitude:NaN}]},
      {commands:[{action:'takeoff',altitude:21},{action:'land'}]},
      {commands:[{action:'takeoff',altitude:5,foo:1},{action:'land'}]},
      {commands:[{action:'takeoff',altitude:5},{action:'hover',duration:-1},{action:'land'}]},
      {commands:[{action:'move_forward',distance:1},{action:'land'}]},
      {commands:[{action:'takeoff',altitude:5},{action:'descend',distance:5},{action:'land'}]},
      {commands:[{action:'takeoff',altitude:5},{action:'move_forward',distance:51},{action:'land'}]},
      {commands:[{action:'takeoff',altitude:5},{action:'move_forward',distance:2,speed:6},{action:'land'}]},
      {commands:[{action:'takeoff',altitude:5},{action:'repeat',count:999,commands:[{action:'hover',duration:1}]},{action:'land'}]},
      {commands:[{action:'takeoff',altitude:5},{action:'repeat',count:4,commands:Array(4).fill({action:'hover',duration:1})},{action:'land'}]},
      {commands:[{action:'takeoff',altitude:5},{action:'move_forward',distance:10,speed:0.01},{action:'land'}]},
    ];
    for(const data of invalid) assert.ok(validateMission(data).errors.length,JSON.stringify(data));
    assert.ok(validateMission(' '.repeat(M.maxSourceBytes+1)).errors.length);
  });
  it('defines planned body-relative ENU targets from a start pose',()=>{
    const result=validateMission({commands:[{action:'takeoff',altitude:5},{action:'move_forward',distance:10},{action:'turn_right',angle:90},{action:'move_left',distance:2},{action:'ascend',distance:1},{action:'land'}]}, {east:1,north:2,up:0,heading:90});
    assert.deepEqual(result.errors,[]);const steps=result.plan!.steps;
    assert.ok(Math.abs(steps[1].target.east-11)<1e-8);assert.ok(Math.abs(steps[3].target.east-13)<1e-8);assert.equal(steps[4].target.up,6);
  });
});
describe('mission execution through shared physics',()=>{
  for(const wind of ['calm','breeze','strong'] as const) for(const preset of PRESETS) it(`${preset.id} completes in ${wind}`,()=>{
    const {model,runner}=fixture(preset.id,wind);run(runner,M.maxDuration+1);
    assert.equal(runner.snapshot.status,'completed',JSON.stringify(runner.snapshot));
    assert.deepEqual(runner.snapshot.completed,runner.plan!.steps.map((_,i)=>i));
    assert.equal(model.state.mode,'grounded');assert.equal(model.state.position.up,0);
  });
  it('pauses, holds and resumes without consuming hover time or skipping commands',()=>{
    const {model,runner}=fixture('return');run(runner,6);runner.pause();const elapsed=runner.snapshot.elapsed,index=runner.snapshot.index;
    run(runner,8);assert.equal(runner.snapshot.elapsed,elapsed);assert.equal(runner.snapshot.index,index);assert.ok(Math.hypot(model.state.velocity.east,model.state.velocity.north,model.state.velocity.up)<0.1);
    runner.resume();run(runner,180);assert.equal(runner.snapshot.status,'completed');
  });
  it('can pause/stop an automatic descent, then resume landing',()=>{
    const {model,runner}=fixture('up-down');
    for(let i=0;i<12000&&model.state.mode!=='landing';i++)runner.update(1/120);
    assert.equal(model.state.mode,'landing');runner.pause();assert.equal(model.state.mode,'flying');run(runner,3);assert.ok(model.state.position.up>0.5);
    runner.resume();run(runner,60);assert.equal(runner.snapshot.status,'completed');
    runner.start();run(runner,5);runner.stop();assert.equal(runner.snapshot.status,'stopped');assert.equal(runner.ownsControl,false);
  });
  it('reruns after completion, resets mid-flight and rejects airborne start',()=>{
    const {model,runner}=fixture('up-down');run(runner,180);assert.equal(runner.start(),true);run(runner,3);runner.stop();
    assert.equal(runner.start(),false);runner.reset();assert.equal(model.state.mode,'grounded');assert.equal(runner.snapshot.status,'ready');assert.deepEqual(runner.plan!.origin,{east:0,north:0,up:0,heading:0});
    assert.equal(runner.start(),true);run(runner,180);assert.equal(runner.snapshot.status,'completed');
  });
  it('enforces timeout and locks mission replacement during execution',()=>{
    const {model,runner}=fixture('return');assert.ok(runner.load(PRESETS[0].mission).length);
    // Simulate a stalled flight model without moving the rendered object.
    model.update=()=>{};run(runner,65);assert.equal(runner.snapshot.status,'failed');assert.match(runner.snapshot.message,/逾時/);
  });
  it('turns a full 360 degrees rather than treating it as zero',()=>{
    const model=new FlightModel(),r=new MissionRunner(model);
    r.load({commands:[{action:'takeoff',altitude:2},{action:'turn_left',angle:360},{action:'land'}]});r.start();let total=0,previous=model.state.heading;
    for(let i=0;i<120*180&&r.ownsControl;i++){r.update(1/120);total+=((model.state.heading-previous+540)%360)-180;previous=model.state.heading;}
    assert.equal(r.snapshot.status,'completed');assert.ok(total < -358);
  });
  it('executes the maximum altitude and high-speed route without crossing the fence',()=>{
    const m=new FlightModel(),r=new MissionRunner(m);
    assert.deepEqual(r.load({commands:[{action:'takeoff',altitude:20},{action:'move_forward',distance:45,speed:5},{action:'land'}]}),[]);
    r.start();run(r,180);assert.equal(r.snapshot.status,'completed',r.snapshot.message);
  });
  it('matches full task execution at 30, 60 and 144 FPS',()=>{
    const results=[30,60,144].map(fps=>{const {model,runner}=fixture('square','strong');run(runner,180,fps);return {state:model.state,task:runner.snapshot};});
    for(const result of results){assert.equal(result.task.status,'completed');assert.deepEqual(result.task.completed,results[0].task.completed);assert.ok(Math.abs(result.state.position.east-results[0].state.position.east)<1e-8);assert.ok(Math.abs(result.task.elapsed-results[0].task.elapsed)<1e-8);}
  });
  it('supports pause during a turn and re-running a completed square',()=>{
    const {runner}=fixture('square');for(let i=0;i<15000&&runner.snapshot.index!==2;i++)runner.update(1/120);
    run(runner,0.5);runner.pause();const index=runner.snapshot.index;run(runner,4);assert.equal(runner.snapshot.index,index);runner.resume();run(runner,180);
    assert.equal(runner.snapshot.status,'completed');assert.equal(runner.start(),true);run(runner,180);assert.equal(runner.snapshot.status,'completed');
  });
});
