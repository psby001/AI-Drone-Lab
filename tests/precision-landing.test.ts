import { it } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import Ajv from 'ajv';
import { createChallengeCatalog,CHALLENGE_DEFINITIONS } from '../src/challenges/catalog';
import { ChallengeManager } from '../src/challenges/ChallengeManager';
import { MemoryResultRepository,LocalResultRepository,personalBests } from '../src/challenges/repository';
import { PrecisionLandingRule,PRECISION_LANDING,precisionLandingScoring,type LandingParams } from '../src/challenges/precisionLanding';
import { FlightModel,initialState,neutralInput } from '../src/core/flight';
import { MissionRunner } from '../src/missions/MissionRunner';
import { ThreeChallengeSceneProvider } from '../src/challenges/scene';
import { buildChallengeSchema } from '../src/challenges/schema';
import type { ControlSource,RuleInput } from '../src/challenges/types';
const params=()=>structuredClone(PRECISION_LANDING.objectives[0].params) as unknown as LandingParams;
const observation=(east=4,north=6,up=0,mode:ReturnType<typeof initialState>['mode']='armed'):RuleInput=>{const drone=initialState();drone.position={east,north,up};drone.mode=mode;return{drone,previous:null,dt:.1,simulation_time:0,events:[]};};
function score(rule:PrecisionLandingRule,complete=true){return precisionLandingScoring.score({completion_time:10,penalty_time:0,completion_rate:complete?1:0,precision:0,collected:0,completed:complete,violations:[],metrics:{'landing-target':rule.metrics()}},PRECISION_LANDING.scoring.params);}
function fixture(repository=new MemoryResultRepository()){
  const c=createChallengeCatalog(),model=new FlightModel(),mission=new MissionRunner(model);let id=0;
  const manager=new ChallengeManager(c.registry,c.rules,c.scoring,repository,{initialize:d=>{mission.reset();model.reset(d.spawn);model.setEnvironment(d.scene.environment.wind,d.scene.environment.direction);},stop:()=>{mission.stop();model.holdPosition();}},()=>new Date('2026-11-02T00:00:00Z'),()=>`precision-${++id}`);
  const scene=new THREE.Scene(),base=new THREE.Group();scene.add(base);const provider=new ThreeChallengeSceneProvider(scene,base,c.scenes);manager.setSceneProvider(provider);
  return{...c,model,mission,manager,repository,scene,base,provider};
}
function start(f:ReturnType<typeof fixture>){assert.equal(f.manager.start(),true);for(let i=0;i<30;i++)f.manager.update(.1,f.model.state,'MANUAL');assert.equal(f.manager.snapshot.status,'RUNNING');}
async function fly(f:ReturnType<typeof fixture>,source:ControlSource='AI_MISSION',offset=0){
  await f.manager.select('precision-landing');start(f);let manual=source==='MANUAL',landing=false;
  if(manual)f.model.arm();else{assert.deepEqual(f.mission.load(PRECISION_LANDING.metadata.example_mission),[]);assert.ok(f.mission.start());}
  for(let i=0;i<180*120&&f.manager.snapshot.status==='RUNNING';i++){
    if(source==='MIXED'&&!manual&&f.model.state.position.up>2){f.mission.stop();manual=true;}
    if(manual){const s=f.model.state,p=s.position,east=4+offset-p.east,north=6-p.north,clamp=(v:number)=>Math.max(-.5,Math.min(.5,v));
      if(!landing&&Math.hypot(east,north)<.12&&Math.hypot(s.velocity.east,s.velocity.north)<.12&&p.up>2.8){f.model.land();landing=true;}
      f.model.update(1/120,landing?neutralInput():{right:clamp(east*.25),forward:clamp(north*.25),vertical:clamp((3-p.up)*.65),yaw:0});
    }else f.mission.update(1/120);
    f.manager.update(1/120,f.model.state,manual?'MANUAL':'AI_MISSION',f.mission.snapshot.status==='failed'?[{type:'mission',id:'failed'}]:[]);
  }return f.manager.snapshot.result!;
}
it('registers the independent landing plugins and validates matching adjustable score bands',()=>{
  const f=fixture();assert.deepEqual(f.registry.list().map(d=>d.id),['waypoint-racing','precision-landing','photo-treasure-hunt']);const validate=new Ajv({strict:false}).compile(buildChallengeSchema(f.rules,f.scoring,f.scenes));assert.equal(validate(PRECISION_LANDING),true);
  const bad=structuredClone(PRECISION_LANDING);bad.id='invalid-landing';bad.scoring.params.metric_id='wrong';assert.throws(()=>f.registry.register(bad),/對應/);bad.scoring.params.metric_id='landing-target';
  bad.scoring.params.bands=[{max_error:1,score:100},{max_error:.5,score:80}];assert.throws(()=>f.registry.register(bad),/分段/);
  bad.scoring.params.bands=[{max_error:4,score:20}];assert.throws(()=>f.registry.register(bad),/外圈/);
  bad.objectives[0].params.max_error=4;f.registry.register(bad);assert.equal(f.registry.get(bad.id).scoring.params.bands instanceof Array,true);f.manager.dispose();
});
it('uses actual airborne/contact state; ground idle and a land event cannot complete the challenge',()=>{
  const rule=new PrecisionLandingRule(params());for(let i=0;i<20;i++){const input=observation();input.events=[{type:'mission',id:'land'}];assert.equal(rule.evaluate(input).complete,false);}
  assert.equal(rule.metrics().landed,false);rule.evaluate(observation(4,6,2,'flying'));
  for(let i=0;i<10;i++)assert.equal(rule.evaluate(observation(4,6,.05,'flying')).complete,false);
  let out;for(let i=0;i<6;i++)out=rule.evaluate(observation());assert.equal(out!.complete,true);assert.equal(score(rule).final_score,100);
});
it('computes all distance bands inclusively and fails outside the configurable maximum',()=>{
  for(const [distance,expected] of [[0,100],[.5,100],[.5001,80],[1,80],[1.5,60],[2,60],[2.5,40],[3,40],[3.01,0]]){
    const rule=new PrecisionLandingRule(params());rule.evaluate(observation(4+distance,6,3,'flying'));let out;for(let i=0;i<6;i++)out=rule.evaluate(observation(4+distance));
    assert.equal(out!.complete,distance<=3);assert.equal(score(rule,out!.complete).final_score,expected);assert.ok(Math.abs(Number(rule.metrics().landing_error)-distance)<1e-10);if(distance>3)assert.match(out!.failed!,/容許範圍/);
  }
});
it('freezes the first contact, rejects low takeoff and prevents relaunch to improve the result',()=>{
  const rule=new PrecisionLandingRule(params());rule.evaluate(observation(6.5,6,3,'flying'));rule.evaluate(observation(6.5));for(let i=0;i<6;i++)rule.evaluate(observation());assert.equal(rule.metrics().landing_error,2.5);assert.equal(score(rule).final_score,40);
  assert.match(rule.evaluate(observation(4,6,1,'flying')).failed!,/再次起飛/);
  const low=new PrecisionLandingRule(params());low.evaluate(observation(4,6,.3,'flying'));const out=low.evaluate(observation());assert.equal(out.complete,false);assert.match(out.failed!,/起飛高度/);assert.equal(score(low,false).final_score,0);
});
for(const source of ['MANUAL','AI_MISSION','MIXED'] as const)it(`precision landing completes via ${source} using the existing model and nonzero spawn`,async()=>{
  const f=fixture(),result=await fly(f,source);assert.equal(f.manager.snapshot.status,'COMPLETED',JSON.stringify({s:f.manager.snapshot,drone:f.model.state,mission:f.mission.snapshot}));assert.equal(result.final_score,100);assert.equal(result.control_source,source);assert.equal(result.score_direction,'higher');assert.ok(Number(result.metrics!['landing-target'].landing_error)<.5);assert.ok(Math.abs(f.model.state.position.east-4)<.5);assert.ok(Math.abs(f.model.state.position.north-6)<.5);assert.equal(f.model.state.position.up,0);assert.equal(f.repository.list().length,1);f.manager.dispose();
});
it('scores an off-center manual landing and rejects a missed target through real physics',async()=>{
  const f=fixture();const partial=await fly(f,'MANUAL',1.5);assert.equal(partial.status,'COMPLETED');assert.equal(partial.final_score,60);const missed=await fly(f,'MANUAL',4);assert.equal(missed.status,'FAILED');assert.equal(missed.final_score,0);assert.equal(missed.is_personal_best,false);f.manager.dispose();
});
it('switching landing/racing scenes clears old objects, metrics and retry state without replacing shared objects',async()=>{
  const f=fixture(),shared=new THREE.Group();shared.name='shared-drone-camera';f.scene.add(shared);
  await f.manager.select('precision-landing');assert.equal(f.scene.getObjectByName('shared-drone-camera'),shared);assert.ok(f.scene.getObjectByName('challenge:precision-landing'));start(f);f.manager.pause();const time=f.manager.snapshot.elapsed;f.manager.update(.1,f.model.state,'MANUAL');assert.equal(f.manager.snapshot.elapsed,time);f.manager.resume();
  const old=f.scene.getObjectByName('challenge:precision-landing')!;let disposals=0;old.traverse(o=>{if(o instanceof THREE.Mesh)o.geometry.addEventListener('dispose',()=>disposals++);});
  await f.manager.select('waypoint-racing');assert.ok(disposals>0);assert.equal(f.scene.getObjectByName('challenge:precision-landing'),undefined);assert.ok(f.scene.getObjectByName('challenge:waypoint-racing'));assert.equal(f.manager.snapshot.metrics['landing-target'],undefined);
  await f.manager.select('precision-landing');assert.equal(f.scene.getObjectByName('challenge:waypoint-racing'),undefined);start(f);f.manager.abort();await f.manager.retry();assert.equal(Object.values(f.manager.snapshot.metrics)[0].landed,false);assert.equal(f.model.state.position.east,-3);assert.equal(f.manager.snapshot.elapsed,0);f.manager.menu();assert.equal(f.base.visible,true);assert.equal(f.scene.children.length,2);f.manager.dispose();
});
it('keeps racing and landing best scores separate, persists/reloads them and finds older retained best records',async()=>{
  const map=new Map<string,string>(),storage={getItem:(key:string)=>map.get(key)??null,setItem:(key:string,value:string)=>{map.set(key,value);}} as Storage,repo=new LocalResultRepository(storage),f=fixture(repo);
  const landing=await fly(f,'AI_MISSION');assert.equal(landing.score_unit,'分');await f.manager.select('waypoint-racing');start(f);assert.deepEqual(f.mission.load(CHALLENGE_DEFINITIONS[0].metadata.example_mission),[]);f.mission.start();
  for(let i=0;i<180*120&&f.manager.snapshot.status==='RUNNING';i++){f.mission.update(1/120);f.manager.update(1/120,f.model.state,'AI_MISSION');}
  assert.equal(f.manager.snapshot.status,'COMPLETED');const race=f.manager.snapshot.result!;assert.equal(race.score_unit,'秒');assert.equal(race.score_direction,'lower');assert.equal(race.previous_best,null);
  for(let i=0;i<20;i++)repo.save({...landing,attempt_id:`lower-${i}`,final_score:40});
  const reloaded=new LocalResultRepository(storage);assert.equal(personalBests(reloaded.list(),PRECISION_LANDING)[0].final_score,100);assert.equal(personalBests(reloaded.list(),CHALLENGE_DEFINITIONS[0])[0].final_score,race.final_score);assert.equal(personalBests(reloaded.list(),PRECISION_LANDING)[0].challenge_id,'precision-landing');
  const changed=structuredClone(PRECISION_LANDING);changed.objectives[0].params.max_error=4;assert.deepEqual(personalBests(reloaded.list(),changed),[]);f.manager.dispose();
});
