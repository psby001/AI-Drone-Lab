import { it } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createChallengeCatalog,CHALLENGE_DEFINITIONS } from '../src/challenges/catalog';
import { ChallengeManager } from '../src/challenges/ChallengeManager';
import { MemoryResultRepository,LocalResultRepository } from '../src/challenges/repository';
import { WaypointRace,waypointEntry,distanceToSegment,deviationIntegral,racingParams,raceTimeScoring,type RacingParams,type RacingWaypoint } from '../src/challenges/racing';
import { racingSceneFactory,RACE_COLORS } from '../src/challenges/racingScene';
import { collisionSampler,disposeSceneGroup } from '../src/challenges/scene';
import { FlightModel,initialState } from '../src/core/flight';
import { MissionRunner } from '../src/missions/MissionRunner';
import type { ChallengeDefinition,ControlSource,RuleInput,ChallengeSnapshot } from '../src/challenges/types';
const position=(east=0,north=0,up=3)=>({east,north,up});
const simple=():RacingParams=>({start:position(0),waypoints:[1,2,3].map((east,i)=>({waypoint_id:`WP${i}`,position:position(east),radius:.2,sequence:i})),d_allow:1,k:2,mode_bonus:{enabled:false,required_mode:'attitude',multiplier:.9,qualification:'all_airborne'}});
function input(a=position(),b=position(),dt=.1,time=dt) {const previous=initialState(),drone=initialState();previous.position=a;drone.position=b;previous.mode=drone.mode='flying';return{previous,drone,dt,simulation_time:time,events:[]};}
function fixture(repository=new MemoryResultRepository()){
  const c=createChallengeCatalog(),model=new FlightModel(),mission=new MissionRunner(model);let id=0;
  const manager=new ChallengeManager(c.registry,c.rules,c.scoring,repository,{initialize:d=>{mission.reset();model.reset(d.spawn);model.setEnvironment(d.scene.environment.wind,d.scene.environment.direction);},stop:()=>{mission.stop();model.holdPosition();}},()=>new Date('2026-11-02T00:00:00Z'),()=>`race-${++id}`);
  manager.setSceneProvider({async load(d){return{sample:collisionSampler(d.scene.objects),dispose(){}};}});return{...c,model,mission,manager,repository};
}
function start(f:ReturnType<typeof fixture>){assert.ok(f.manager.start());for(let i=0;i<30;i++)f.manager.update(.1,f.model.state,'MANUAL');assert.equal(f.manager.snapshot.status,'RUNNING');}
it('publishes both formal levels and validates unique ordered waypoints and dedicated parameters',()=>{
  const f=fixture();assert.deepEqual(f.registry.list().map(d=>d.id),['waypoint-racing','precision-landing','photo-treasure-hunt']);
  const d=structuredClone(CHALLENGE_DEFINITIONS[0]);d.id='invalid';const p=d.objectives[0].params as unknown as RacingParams;p.waypoints[1].sequence=p.waypoints[0].sequence;assert.throws(()=>f.registry.register(d),/sequence/);
  p.waypoints[1].sequence=2;p.waypoints[1].waypoint_id=p.waypoints[0].waypoint_id;assert.throws(()=>f.registry.register(d),/ID/);
  p.waypoints[1].waypoint_id='new';p.waypoints[1].altitude={min:4,max:2};assert.throws(()=>f.registry.register(d),/高度/);
  p.waypoints[1].altitude={min:2,max:4};p.k=-1;assert.throws(()=>f.registry.register(d));f.manager.dispose();
});
it('detects high-speed swept sphere entry, tangency, stationarity and joint heading/altitude constraints',()=>{
  const w:RacingWaypoint={waypoint_id:'sphere',position:position(),radius:1,sequence:0};
  assert.equal(waypointEntry(position(-3),position(3),w,0,0),1/3);assert.equal(waypointEntry(position(-3,1),position(3,1),w,0,0),.5);
  assert.equal(waypointEntry(position(0),position(0),w,0,0),0);assert.equal(waypointEntry(position(2),position(2),w,0,0),null);
  const constrained={...w,radius:2,position:position(0,0,1),heading:{degrees:0,tolerance:2},altitude:{min:.8,max:1.2}};
  assert.ok(Math.abs(waypointEntry(position(-1,0,0),position(1,0,2),constrained,350,10)!-.4)<1e-9);
  assert.equal(waypointEntry(position(-1,0,0),position(1,0,2),constrained,90,90),null);
  assert.equal(waypointEntry(position(-1,0,3),position(1,0,3),constrained,0,0),null);
});
it('cannot skip future waypoints; accepts several in one segment only in traversal order, and stops at exact finish time',()=>{
  const race=new WaypointRace(simple());race.evaluate(input(position(2.9),position(3.1)));assert.equal(race.metrics().completed_waypoints,0);
  const reverse=new WaypointRace(simple());const result=reverse.evaluate(input(position(4),position(0),1,1));assert.equal(result.complete,false);assert.equal(reverse.metrics().completed_waypoints,1);
  const forward=new WaypointRace(simple()),out=forward.evaluate(input(position(0),position(4),1,1));assert.equal(out.complete,true);assert.ok(Math.abs(out.completed_at!-.7)<1e-10);assert.equal(out.metrics.deviation_penalty,0);
  const idle=input(position(0),position(4));idle.drone.mode='grounded';assert.equal(new WaypointRace(simple()).evaluate(idle).progress,0);
});
it('integrates excess deviation in metres × simulation seconds with close agreement at 10/30/60/144 FPS',()=>{
  const a=position(0),b=position(10);assert.equal(distanceToSegment(position(5,3),a,b),3);assert.equal(distanceToSegment(position(-2),a,b),2);
  const scores=[];for(const fps of [10,30,60,144]){let total=0;for(let i=0;i<fps*2;i++)total+=deviationIntegral(position(i/fps*5,3),position((i+1)/fps*5,3),a,b,1/fps,1,2);scores.push(total);assert.ok(Math.abs(total-8)<1e-9);}
  assert.ok(Math.max(...scores)-Math.min(...scores)<1e-8);
  const varying=[];for(const fps of [10,30,60,144]){let total=0;for(let i=0;i<fps*2;i++)total+=deviationIntegral(position(i/fps*5,i/fps*2),position((i+1)/fps*5,(i+1)/fps*2),a,b,1/fps,1.3,1.7);varying.push(total);}
  assert.ok(Math.max(...varying)-Math.min(...varying)<.0001);
});
it('penalizes only the currently active leg and never integrates the part after the finish',()=>{
  const p=simple();p.waypoints[0].position=position(10);p.waypoints[1].position=position(10,10);p.waypoints[2].position=position(0,10);const race=new WaypointRace(p);
  const out=race.evaluate(input(position(0,10),position(0,10),.1,.1));assert.equal(out.progress,0);assert.ok(Math.abs(Number(out.metrics.deviation_penalty)-1.8)<1e-9);
  const finishing=simple();finishing.d_allow=0;const done=new WaypointRace(finishing);done.evaluate(input(position(0),position(4),1,1));assert.ok(Math.abs(Number(done.metrics().deviation_penalty)-.02)<.00001);
});
it('mode bonus is off by default, requires every airborne sample, and cannot be earned by switching at the finish',()=>{
  const p=simple(),off=new WaypointRace(p),frame=input(position(0),position(.1));frame.drone.controlMode='attitude';if(frame.previous)(frame.previous as typeof frame.drone).controlMode='attitude';off.evaluate(frame);assert.equal(off.metrics().mode_multiplier,1);
  p.mode_bonus.enabled=true;const eligible=new WaypointRace(p);eligible.evaluate(frame);assert.equal(eligible.metrics().mode_multiplier,.9);
  const late=new WaypointRace(p);late.evaluate(input(position(0),position(.1)));late.evaluate(frame);assert.equal(late.metrics().mode_multiplier,1);assert.equal(late.metrics().mode_disqualified,true);
  const switchBack=new WaypointRace(p);switchBack.evaluate(frame);switchBack.evaluate(input(position(.1),position(.2)));switchBack.evaluate(frame);assert.equal(switchBack.metrics().mode_multiplier,1);
  const score=raceTimeScoring.score({completion_time:10,penalty_time:0,completion_rate:1,precision:0,collected:3,completed:true,violations:[],metrics:{route:{deviation_penalty:2,mode_multiplier:.9}}},{metric_id:'route'});assert.equal(score.final_score,10.8);
});
for(const source of ['MANUAL','AI_MISSION','MIXED'] as const)it(`completes the same race through the existing flight model using ${source}`,async()=>{
  const f=fixture();await f.manager.select('waypoint-racing');start(f);const params=racingParams(f.manager.snapshot.definition!.objectives[0].params);let manual=source==='MANUAL';
  if(manual)f.model.arm();else{assert.deepEqual(f.mission.load(CHALLENGE_DEFINITIONS[0].metadata.example_mission),[]);assert.ok(f.mission.start());}
  for(let i=0;i<180*120&&f.manager.snapshot.status==='RUNNING';i++){
    const count=Number(f.manager.snapshot.metrics['race-route'].completed_waypoints);
    if(source==='MIXED'&&!manual&&count>=2){f.mission.stop();manual=true;}
    const actual:ControlSource=manual?'MANUAL':'AI_MISSION';
    if(manual){const target=params.waypoints[count].position,s=f.model.state,p=s.position,clamp=(v:number,max:number)=>Math.max(-max,Math.min(max,v));f.model.update(1/120,{right:clamp((target.east-p.east)*.25,.5),forward:clamp((target.north-p.north)*.25,.5),vertical:clamp((target.up-p.up)*.65,.7),yaw:0});}else f.mission.update(1/120);
    f.manager.update(1/120,f.model.state,actual,f.mission.snapshot.status==='failed'?[{type:'mission',id:'failed'}]:[]);
  }
  assert.equal(f.manager.snapshot.status,'COMPLETED',JSON.stringify({s:f.manager.snapshot,mission:f.mission.snapshot,drone:f.model.state}));const result=f.manager.snapshot.result!;
  assert.equal(result.metrics!['race-route'].completed_waypoints,5);assert.equal(result.control_source,source);assert.equal(result.metrics!['race-route'].mode_multiplier,1);assert.equal(result.is_personal_best,true);assert.equal(f.repository.list().length,1);
  assert.ok(result.completion_time<180);assert.ok(result.lines.some(l=>l.label==='最終等效時間'));f.manager.dispose();
});
it('replays an identical continuous trajectory consistently at 30/60/144 FPS',()=>{
  const scores=[];for(const fps of [30,60,144]){const p=simple();p.waypoints.forEach((w,i)=>{w.position=position(4*(i+1));w.radius=.3;});p.d_allow=.2;const race=new WaypointRace(p);let completed=0;
    for(let i=0;i<fps*4;i++){const start=i/fps,end=(i+1)/fps,path=(t:number)=>position(t*4,Math.sin(Math.PI*t)*.4);const out=race.evaluate(input(path(start),path(end),1/fps,end));if(out.complete){completed=out.completed_at!;break;}}
    scores.push(completed+Number(race.metrics().deviation_penalty));
  }assert.ok(Math.max(...scores)-Math.min(...scores)<.005,JSON.stringify(scores));
});
it('pauses without accumulating time/penalty; failure covers boundary, collision, mission abort and timeout',async()=>{
  const f=fixture();await f.manager.select('waypoint-racing');start(f);f.model.state.position.north=-10;f.model.state.mode='flying';f.manager.update(.1,f.model.state,'MANUAL');f.manager.pause();const before=structuredClone(f.manager.snapshot);for(let i=0;i<50;i++)f.manager.update(.1,f.model.state,'MANUAL');assert.equal(f.manager.snapshot.elapsed,before.elapsed);assert.deepEqual(f.manager.snapshot.metrics,before.metrics);f.manager.resume();f.model.state.position.east=26;f.manager.update(.1,f.model.state,'MANUAL');assert.equal(f.manager.snapshot.status,'FAILED');
  await f.manager.retry();start(f);f.manager.update(.1,f.model.state,'AI_MISSION',[{type:'mission',id:'stopped'}]);assert.equal(f.manager.snapshot.status,'FAILED');
  await f.manager.retry();start(f);f.model.state.position={east:-4,north:4,up:1.5};f.manager.update(.1,f.model.state,'MANUAL');assert.equal(f.manager.snapshot.status,'FAILED');
  await f.manager.retry();start(f);for(let i=0;i<1801;i++)f.manager.update(.1,f.model.state,'MANUAL');assert.equal(f.manager.snapshot.status,'FAILED');assert.match(f.manager.snapshot.message,/時間/);f.manager.dispose();
});
it('compares best scores only for successful attempts with the same settings and control source',async()=>{
  const repo=new MemoryResultRepository(),f=fixture(repo),d=structuredClone(CHALLENGE_DEFINITIONS[0]);d.id='record-race';const recordParams=simple();recordParams.start={...d.spawn.position};d.objectives[0].params=recordParams as unknown as Record<string,unknown>;f.registry.register(d);
  async function run(steps:number,source:ControlSource){await f.manager.select(d.id);start(f);f.model.state.mode='flying';f.model.state.position=position(0);for(let i=0;i<steps&&f.manager.snapshot.status==='RUNNING';i++){f.model.state.position=position((i+1)/steps*4);f.manager.update(.1,f.model.state,source);}return f.manager.snapshot.result!;}
  const fast=await run(10,'MANUAL');assert.equal(fast.is_personal_best,true);const slow=await run(20,'MANUAL');assert.equal(slow.is_personal_best,false);assert.equal(slow.previous_best,fast.final_score);
  const ai=await run(20,'AI_MISSION');assert.equal(ai.is_personal_best,true);assert.equal(ai.previous_best,null);
  for(let i=0;i<110;i++)repo.save({...slow,attempt_id:`slower-${i}`});assert.ok(repo.list().some(r=>r.attempt_id===fast.attempt_id));assert.equal(repo.list().length,100);
  await f.manager.retry();start(f);f.manager.abort();assert.equal(f.manager.snapshot.result?.is_personal_best,false);
  const map=new Map<string,string>(),storage={getItem:(k:string)=>map.get(k)??null,setItem:(k:string,v:string)=>{map.set(k,v);}} as unknown as Storage,persist=new LocalResultRepository(storage);persist.save(fast);assert.deepEqual(new LocalResultRepository(storage).list()[0],fast);f.manager.dispose();
});
it('updates waypoint colors from actual progress and disposes the racing scene',()=>{
  const d=CHALLENGE_DEFINITIONS[0],group=racingSceneFactory.create(d),snapshot={metrics:{'race-route':{completed_waypoints:2}}} as unknown as ChallengeSnapshot;racingSceneFactory.update!(group,snapshot);
  for(const [i,color] of [[0,RACE_COLORS.completed],[2,RACE_COLORS.current],[3,RACE_COLORS.pending]] as const){const mesh=group.getObjectByName(`race-waypoint-${i}`)!.children[0] as THREE.Mesh;assert.equal((mesh.material as THREE.MeshStandardMaterial).color.getHexString(),color.slice(1));}
  let disposed=0;group.traverse(o=>{if(o instanceof THREE.Mesh)o.geometry.addEventListener('dispose',()=>disposed++);});disposeSceneGroup(group);assert.ok(disposed>0);assert.equal(group.children.length,0);
});
