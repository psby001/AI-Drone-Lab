import { MISSION_LIMITS as Budget } from '../src/config/limits';
import { it } from 'node:test';
import assert from 'node:assert/strict';
import { validateMission } from '../src/missions/validate';
import { parallelPose,parallelSample } from '../src/missions/parallel';
import { FlightModel } from '../src/core/flight';
import { MissionRunner } from '../src/missions/MissionRunner';
import { PRESETS } from '../src/missions/presets';
import type { Mission,ParallelCommand,MissionCommand } from '../src/missions/types';
const circle=()=>structuredClone(PRESETS.find(p=>p.id==='parallel-circle')!.mission);
const wrap=(commands:MissionCommand[]):Mission=>({version:'1.2',commands:[{action:'takeoff',altitude:4},...commands,{action:'land'}]});
const parallel=(commands:ParallelCommand['commands'],reference_frame?:ParallelCommand['reference_frame']):ParallelCommand=>({action:'parallel',commands,reference_frame});
const turn={action:'turn_right',angle:90} as const;
const forward={action:'move_forward',distance:5} as const;
const tick=(runner:MissionRunner,seconds:number,fps=120)=>{for(let i=0;i<seconds*fps;i++)runner.update(1/fps);};
it('compiles a body-relative full circle as one phase with two budgeted child commands',()=>{
  const result=validateMission(circle());assert.deepEqual(result.errors,[]);const plan=result.plan!,step=plan.steps[1],t=step.trajectory!;
  assert.equal(plan.steps.length,3);assert.equal(plan.commandCount,4);assert.equal(step.target.heading,360);
  assert.ok(Math.hypot(step.target.east,step.target.north)<1e-8);
  const quarter=parallelPose(t,0.25),half=parallelPose(t,0.5);
  assert.ok(Math.abs(quarter.east-5)<1e-8);assert.ok(Math.abs(quarter.north-5)<1e-8);
  assert.ok(Math.abs(half.east-10)<1e-8);assert.ok(Math.abs(half.north)<1e-8);
});
it('supports four independent axes while limiting combined horizontal speed and easing endpoints',()=>{
  const plan=validateMission(PRESETS.find(p=>p.id==='parallel-four-axes')!.mission).plan!;
  assert.equal(plan.commandCount,6);assert.deepEqual(plan.steps[1].target,{east:4,north:8,up:5,heading:90});
  const t=plan.steps[1].trajectory!;
  for(let n=0;n<=100;n++){const sample=parallelSample(t,t.duration*n/100);assert.ok(Math.hypot(sample.velocity.east,sample.velocity.north)<=2+1e-9);assert.ok(Math.abs(sample.velocity.up)<=1+1e-9);assert.ok(Math.abs(sample.yawRate)<=45+1e-9);}
  assert.equal(parallelSample(t,0).yawRate,0);assert.equal(parallelSample(t,t.duration).yawRate,0);
});
it('inherits persistent speeds and keeps child overrides scoped to their group',()=>{
  const result=validateMission(wrap([{action:'set_speed',speed:2,vertical_speed:.5},parallel([{action:'move_forward',distance:4,speed:4},{action:'ascend',distance:2},turn]),{action:'move_forward',distance:1}]));
  assert.deepEqual(result.errors,[]);assert.equal(result.plan!.steps[2].speeds.horizontal,4);assert.equal(result.plan!.steps[2].speeds.vertical,.5);assert.equal(result.plan!.steps[2].trajectory!.duration,6);assert.equal(result.plan!.steps[3].speeds.horizontal,2);
});
it('rejects conflicting axes, unsupported lifecycle/config commands, nesting and invalid versions',()=>{
  const invalid:unknown[]=[
    parallel([forward,{action:'move_backward',distance:2}]),parallel([turn,{action:'turn_left',angle:30}]),
    parallel([{action:'ascend',distance:2},{action:'change_altitude',altitude:5}]),
    {action:'parallel',commands:[forward,{action:'land'}]},
    {action:'parallel',commands:[forward,{action:'set_speed',speed:2}]},
    {action:'parallel',commands:[forward,{action:'hover',duration:1}]},
    {action:'parallel',commands:[forward,{action:'goto_local',x:1,y:1,z:4}]},
    {action:'parallel',commands:[forward,{action:'parallel',commands:[forward,turn]}]},
    {action:'parallel',commands:[forward]},
  ];
  for(const command of invalid)assert.ok(validateMission(wrap([command as MissionCommand])).errors.length,JSON.stringify(command));
  for(const version of ['1.0','1.1'])assert.ok(validateMission({...circle(),version}).errors.length);
  const noVersion=circle();delete noVersion.version;assert.deepEqual(validateMission(noVersion).errors,[]);
});
it('counts child commands through repeat and rejects too many, too slow or too high',()=>{
  assert.ok(validateMission(wrap([{action:'repeat',count:4,commands:Array(Math.floor((Budget.maxCommands-2)/16)+1).fill(parallel([{action:'move_forward',distance:.01},{action:'move_right',distance:.01},{action:'ascend',distance:.001},{action:'turn_right',angle:.01}]))}])).errors.some(e=>e.includes(String(Budget.maxCommands))));
  assert.ok(validateMission(wrap([parallel([{action:'move_forward',distance:20,speed:0.1},turn])])).errors.some(e=>e.includes('60')));
  assert.ok(validateMission(wrap([parallel([{action:'ascend',distance:18},turn])])).errors.length);
  assert.ok(validateMission({commands:[parallel([forward,turn]),{action:'land'}]}).errors.length);
});
it('checks the entire arc against both fences even if the final position returns home',()=>{
  assert.ok(validateMission(circle(),{east:45,north:0,up:0,heading:0}).errors.some(e=>e.includes('50')));
  const partial=wrap([parallel([{action:'move_forward',distance:1},{action:'turn_right',angle:10}])]);
  assert.deepEqual(validateMission(partial,{east:45,north:0,up:0,heading:0}).errors,[]);
  const offset=validateMission(circle(),{east:2,north:3,up:0,heading:90}).plan!.steps[1].trajectory!;
  const q=parallelPose(offset,0.25);assert.ok(Math.abs(q.east-7)<1e-8);assert.ok(Math.abs(q.north+2)<1e-8);
});
it('physically moves and rotates together around the planned circle, without early completion',()=>{
  const model=new FlightModel('strong'),runner=new MissionRunner(model);assert.deepEqual(runner.load(circle()),[]);runner.start();
  let together=0,minN=0,maxN=0,maxE=0,maxRadiusError=0;
  for(let i=0;i<21600&&runner.ownsControl;i++){
    runner.update(1/120);
    if(runner.snapshot.index===1){const p=model.state.position,v=model.state.velocity;
      if(Math.hypot(v.east,v.north)>.3&&Math.abs(model.state.yawRate)>3)together++;
      minN=Math.min(minN,p.north);maxN=Math.max(maxN,p.north);maxE=Math.max(maxE,p.east);
      maxRadiusError=Math.max(maxRadiusError,Math.abs(Math.hypot(p.east-5,p.north)-5));
    }
  }
  assert.equal(runner.snapshot.status,'completed',runner.snapshot.message);assert.ok(together>500);assert.ok(minN< -4.5&&maxN>4.5&&maxE>9.5);
  assert.ok(maxRadiusError<0.65,`radius error ${maxRadiusError}`);assert.equal(model.state.mode,'grounded');
});
it('pauses a spiral without consuming its phase progress and resumes all channels',()=>{
  const model=new FlightModel('breeze'),runner=new MissionRunner(model);runner.load(PRESETS.find(p=>p.id==='parallel-spiral')!.mission);runner.start();
  for(let n=0;n<12000&&!(runner.snapshot.index===1&&model.state.heading>80);n++)runner.update(1/120);
  assert.equal(runner.snapshot.index,1);runner.pause();const elapsed=runner.snapshot.elapsed;
  tick(runner,6);assert.equal(runner.snapshot.elapsed,elapsed);assert.equal(runner.snapshot.index,1);assert.ok(Math.hypot(model.state.velocity.east,model.state.velocity.north,model.state.velocity.up)<.2);
  runner.resume();tick(runner,180);assert.equal(runner.snapshot.status,'completed');assert.ok(runner.start());tick(runner,3);runner.stop();assert.equal(runner.snapshot.status,'stopped');runner.reset();assert.equal(runner.snapshot.status,'ready');
});
it('keeps start-frame translation straight while rotating and matches at 30/60/144 FPS',()=>{
  const mission=wrap([parallel([{action:'move_forward',distance:10,speed:2},{action:'turn_right',angle:360,speed:60}],'start')]);
  const results=[30,60,144].map(fps=>{
    const model=new FlightModel('breeze'),runner=new MissionRunner(model);assert.deepEqual(runner.load(mission),[]);runner.start();let maxEast=0;
    for(let n=0;n<181*fps&&runner.ownsControl;n++){runner.update(1/fps);maxEast=Math.max(maxEast,Math.abs(model.state.position.east));}
    assert.equal(runner.snapshot.status,'completed');assert.ok(maxEast<.3);assert.ok(Math.abs(model.state.position.north-10)<.3);return runner.snapshot.elapsed;
  });
  assert.ok(Math.max(...results)-Math.min(...results)<1e-8);
});
