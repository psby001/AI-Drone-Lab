import { MISSION_LIMITS as Budget } from '../src/config/limits';
import { it } from 'node:test';
import assert from 'node:assert/strict';
import { validateMission } from '../src/missions/validate';
import { gpsToLocal } from '../src/missions/geodesy';
import { FlightModel } from '../src/core/flight';
import { MissionRunner } from '../src/missions/MissionRunner';
import { PRESETS } from '../src/missions/presets';
import type { MissionCommand, MissionPose } from '../src/missions/types';
const takeoff:MissionCommand={action:'takeoff',altitude:3};
const land:MissionCommand={action:'land'};
function compile(commands:MissionCommand[],origin?:MissionPose){
  const result=validateMission({commands},origin);assert.deepEqual(result.errors,[]);return result.plan!;
}
it('persists speed settings while single-command overrides stay local',()=>{
  const p=compile([{action:'set_speed',speed:2,vertical_speed:0.8},takeoff,
    {action:'move_forward',distance:2,speed:3},{action:'move_backward',distance:2},
    {action:'change_altitude',altitude:4,speed:1.5},{action:'change_altitude',altitude:3},land]);
  assert.equal(p.steps[1].speeds.vertical,0.8);assert.equal(p.steps[2].speeds.horizontal,3);
  assert.equal(p.steps[3].speeds.horizontal,2);assert.equal(p.steps[4].speeds.vertical,1.5);
  assert.equal(p.steps[5].speeds.vertical,0.8);assert.deepEqual(p.steps[0].target,p.origin);
});
it('uses launch-relative absolute altitude and ENU coordinates independent of heading',()=>{
  const p=compile([takeoff,{action:'change_altitude',altitude:4},{action:'ascend',distance:1},
    {action:'goto_local',x:2,y:3,z:6},land],{east:5,north:6,up:0,heading:90});
  assert.equal(p.steps[1].target.up,4);assert.equal(p.steps[2].target.up,5);
  assert.deepEqual(p.steps[3].target,{east:7,north:9,up:6,heading:90});
});
it('handles shortest and directed headings across north and the 180 degree tie',()=>{
  for(const [direction,expected] of [['shortest',370],['right',370],['left',10]] as const){
    const p=compile([takeoff,{action:'set_heading',heading:10,direction},land],{east:0,north:0,up:0,heading:350});
    assert.equal(p.steps[1].target.heading,expected);
  }
  assert.equal(compile([takeoff,{action:'set_heading',heading:180},land]).steps[1].target.heading,180);
  assert.equal(compile([takeoff,{action:'set_heading',heading:0,direction:'right'},land]).steps[1].target.heading,0);
});
it('projects WGS84 GPS into metres, including a date-line crossing',()=>{
  const east=gpsToLocal({latitude:0,longitude:0.0001},{latitude:0,longitude:0});
  const north=gpsToLocal({latitude:0.0001,longitude:0},{latitude:0,longitude:0});
  assert.ok(Math.abs(east.east-11.1319490793)<1e-6);assert.ok(Math.abs(east.north)<1e-9);
  assert.ok(Math.abs(north.north-11.0574275822)<1e-6);
  const crossing=gpsToLocal({latitude:0,longitude:-179.9999},{latitude:0,longitude:179.9999});
  assert.ok(Math.abs(crossing.east-22.2638981586)<1e-5);
  assert.throws(()=>gpsToLocal({latitude:0,longitude:180},{latitude:0,longitude:0}));
  assert.throws(()=>gpsToLocal({latitude:91,longitude:0},{latitude:0,longitude:0}));
});
it('uses an explicit GPS home and validates GPS destinations against the flight fence',()=>{
  const commands=[takeoff,{action:'goto_gps',latitude:0,longitude:0.0001,altitude:4},land];
  assert.ok(validateMission({commands}).errors.length);
  const result=validateMission({home:{latitude:0,longitude:0},commands},{east:2,north:3,up:0,heading:90});
  assert.deepEqual(result.errors,[]);assert.ok(Math.abs(result.plan!.steps[1].target.east-13.1319490793)<1e-6);
  assert.equal(result.plan!.steps[1].target.north,3);assert.equal(result.plan!.steps[1].target.up,4);
  assert.ok(validateMission({home:{latitude:0,longitude:0},commands:[takeoff,{action:'goto_gps',latitude:0,longitude:0.001,altitude:4},land]}).errors.length);
});
it('expands waypoints and all six RTL stages into the configured shared command budget',()=>{
  const points=Array.from({length:8},(_,i)=>({x:i%2,y:1,z:3}));
  const padding=Array(Math.max(0,Budget.maxCommands-15)).fill({action:'set_speed',speed:2});
  const valid=compile([takeoff,...padding,{action:'follow_waypoints',frame:'local',waypoints:points},{action:'return_to_launch'}]);
  assert.equal(valid.steps.length,Budget.maxCommands);assert.equal(valid.steps.filter(s=>s.label?.startsWith('返航')).length,6);
  assert.ok(validateMission({commands:[takeoff,...padding,{action:'follow_waypoints',frame:'local',waypoints:[...points,points[0]]},{action:'return_to_launch'}]}).errors.length);
  assert.ok(validateMission({commands:[takeoff,{action:'follow_waypoints',frame:'local',waypoints:[]},land]}).errors.length);
  assert.ok(validateMission({commands:[takeoff,{action:'follow_waypoints',frame:'local',waypoints:Array(11).fill(points[0])},land]}).errors.length);
  assert.ok(validateMission({commands:[takeoff,{action:'repeat',count:4,commands:Array(Math.floor((Budget.maxCommands-2)/32)+1).fill({action:'follow_waypoints',frame:'local',waypoints:points})},land]}).errors.length);
});
it('RTL never descends before returning and restores the actual launch pose',()=>{
  const p=compile([{action:'takeoff',altitude:8},{action:'goto_local',x:4,y:5,z:8},
    {action:'set_heading',heading:180},{action:'return_to_launch',altitude:5}],{east:2,north:3,up:0,heading:45});
  assert.equal(p.steps[3].target.up,8);
  assert.equal(p.steps[4].target.east,2);assert.equal(p.steps[4].target.north,3);
  assert.equal(((p.steps[5].target.heading%360)+360)%360,45);
  assert.equal(p.steps[6].target.up,2);assert.equal(p.steps.at(-1)!.command.action,'land');
  assert.ok(validateMission({commands:[takeoff,{action:'return_to_launch'},land]}).errors.length);
});
it('rejects invalid advanced parameters and preserves explicit legacy version compatibility',()=>{
  for(const command of [{action:'set_speed',speed:0},{action:'set_speed',speed:6},
    {action:'set_speed',speed:2,vertical_speed:3},{action:'set_heading',heading:360},
    {action:'change_altitude',altitude:0},{action:'goto_local',x:40,y:40,z:3}]){
    assert.ok(validateMission({commands:[takeoff,command,land]}).errors.length,JSON.stringify(command));
  }
  assert.deepEqual(validateMission({version:'1.0',commands:[takeoff,land]}).errors,[]);
  assert.ok(validateMission({version:'1.0',commands:[takeoff,{action:'set_heading',heading:90},land]}).errors.length);
  assert.deepEqual(validateMission({version:'1.1',commands:[takeoff,{action:'set_heading',heading:90},land]}).errors,[]);
});
it('pauses and resumes inside a waypoint sequence and RTL without skipping steps',()=>{
  const runner=new MissionRunner(new FlightModel('breeze'));
  assert.deepEqual(runner.load(PRESETS.find(p=>p.id==='local-waypoints')!.mission),[]);assert.ok(runner.start());
  for(const index of [3,6]){
    for(let n=0;n<20000&&runner.snapshot.index<index;n++)runner.update(1/120);
    assert.equal(runner.snapshot.status,'running');assert.equal(runner.snapshot.index,index);
    runner.pause();const elapsed=runner.snapshot.elapsed;
    for(let n=0;n<360;n++)runner.update(1/120);
    assert.equal(runner.snapshot.index,index);assert.equal(runner.snapshot.elapsed,elapsed);runner.resume();
  }
  for(let n=0;n<21600;n++)runner.update(1/120);
  assert.equal(runner.snapshot.status,'completed');assert.deepEqual(runner.snapshot.completed,runner.plan!.steps.map((_,i)=>i));
});
it('runs GPS/RTL through shared physics at 30, 60 and 144 FPS and can run again',()=>{
  for(const fps of [30,60,144]){
    const model=new FlightModel('strong'),runner=new MissionRunner(model);
    assert.deepEqual(runner.load(PRESETS.find(p=>p.id==='gps-waypoints')!.mission),[]);assert.ok(runner.start());
    for(let n=0;n<181*fps;n++)runner.update(1/fps);
    assert.equal(runner.snapshot.status,'completed');assert.equal(model.state.mode,'grounded');
    assert.ok(Math.hypot(model.state.position.east,model.state.position.north)<0.3);
    assert.ok(runner.start());for(let n=0;n<181*fps;n++)runner.update(1/fps);
    assert.equal(runner.snapshot.status,'completed');
  }
});
