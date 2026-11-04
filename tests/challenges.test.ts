import { it } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createChallengeCatalog,CHALLENGE_DEFINITIONS } from './fixtures/challenge-catalog';
import { ChallengeManager } from '../src/challenges/ChallengeManager';
import { MemoryResultRepository,LocalResultRepository } from '../src/challenges/repository';
import { ChallengeRuleEngine } from '../src/challenges/rules';
import { definitionValidator,buildChallengeSchema } from '../src/challenges/schema';
import { ThreeChallengeSceneProvider,collisionSampler,seededRandom } from '../src/challenges/scene';
import { FlightModel,initialState,neutralInput } from '../src/core/flight';
import { MissionRunner } from '../src/missions/MissionRunner';
import type { ChallengeSceneHandle,ChallengeSceneProvider,ControlSource,RuleInput,ResultRepository } from '../src/challenges/types';
import Ajv from 'ajv';
function fixture(repository:ResultRepository=new MemoryResultRepository()){
  const catalog=createChallengeCatalog(),model=new FlightModel(),mission=new MissionRunner(model);let loads=0,disposals=0,stops=0;
  const manager=new ChallengeManager(catalog.registry,catalog.rules,catalog.scoring,repository,{initialize:d=>{mission.reset();model.reset(d.spawn);model.setEnvironment(d.scene.environment.wind,d.scene.environment.direction);},stop:()=>{stops++;mission.stop();model.holdPosition();}},()=>new Date('2026-11-02T00:00:00Z'),()=>`attempt-${loads}`);
  manager.setSceneProvider({async load(){loads++;let disposed=false;return{dispose(){if(!disposed){disposals++;disposed=true;}}};}});
  return{...catalog,model,mission,manager,repository,counts:()=>({loads,disposals,stops})};
}
function countdown(f:ReturnType<typeof fixture>){assert.equal(f.manager.start(),true);for(let i=0;i<30;i++)f.manager.update(.1,f.model.state,'MANUAL');assert.equal(f.manager.snapshot.status,'RUNNING');}
it('validates plugin-specific schemas, duplicate IDs, spawn, unsupported kinds and mutation isolation',()=>{
  const c=createChallengeCatalog(),validate=definitionValidator(c.rules,c.scoring,c.scenes);
  for(const d of CHALLENGE_DEFINITIONS){assert.equal(validate(d).id,d.id);const schema=buildChallengeSchema(c.rules,c.scoring,c.scenes);assert.ok(new Ajv({strict:false}).compile(schema)(d));}
  const d=structuredClone(CHALLENGE_DEFINITIONS[0]);d.objectives[0].params.radius=-1;assert.throws(()=>validate(d));
  d.objectives[0].params.radius=1;d.scene.type='missing';assert.throws(()=>validate(d));d.scene.type='training-ground';d.spawn.position.east=49;assert.throws(()=>validate(d));
  d.spawn.position.east=0;d.objectives[1].id=d.objectives[0].id;assert.throws(()=>validate(d));
  assert.throws(()=>c.registry.register(CHALLENGE_DEFINITIONS[0]));const copy=c.registry.get('steady-hover');copy.objectives.length=0;assert.equal(c.registry.get('steady-hover').objectives.length,2);
});
it('adds a new rule, scoring strategy and challenge without changing the manager',async()=>{
  const f=fixture();f.rules.register('height-once',{schema:{type:'object',additionalProperties:false},create:()=>({evaluate:i=>({progress:i.drone.position.up/2,complete:i.drone.position.up>=2})})});
  f.scoring.register('custom',{schema:{type:'object'},score:c=>({final_score:c.completed?123:0,score_unit:'stars',score_direction:'higher',lines:[],penalties:[],bonuses:[]})});
  f.registry.register({...CHALLENGE_DEFINITIONS[0],id:'extension',objectives:[{id:'height',title:'height',order:0,type:'height-once',params:{}}],scoring:{type:'custom',params:{}}});
  await f.manager.select('extension');countdown(f);f.model.state.position.up=2;f.manager.update(.1,f.model.state,'MANUAL');assert.equal(f.manager.snapshot.result?.final_score,123);f.manager.dispose();
});
it('counts only real state, respects objective order, dwell reset, landing and mode-independent evaluation',()=>{
  const c=createChallengeCatalog(),engine=new ChallengeRuleEngine(c.registry.get('steady-hover'),c.rules),drone=initialState();
  const input:RuleInput={drone,previous:null,dt:.1,simulation_time:0,events:[{type:'mission',id:'takeoff'}]};
  for(let i=0;i<20;i++)assert.equal(engine.evaluate(input).objectives[0].progress,0);
  drone.position.up=3;drone.mode='flying';drone.controlMode='attitude';for(let i=0;i<8;i++)engine.evaluate(input);
  drone.velocity.east=2;assert.equal(engine.evaluate(input).objectives[0].progress,0);drone.velocity.east=0;
  for(let i=0;i<15;i++)engine.evaluate(input);assert.equal(engine.progress()[0].completed,true);assert.equal(engine.progress()[1].completed,false);
  drone.position.up=0;drone.mode='armed';let out;for(let i=0;i<5;i++)out=engine.evaluate(input);assert.equal(out?.completed,true);engine.dispose();
});
for(const id of ['steady-hover','waypoint-garden'])for(const source of ['MANUAL','AI_MISSION'] as const){
  it(`${id} completes through the shared FlightModel using ${source}`,async()=>{
    const f=fixture();await f.manager.select(id);countdown(f);
    if(source==='AI_MISSION'){assert.deepEqual(f.mission.load(f.manager.snapshot.definition!.metadata.example_mission),[]);assert.equal(f.mission.start(),true);}else f.model.arm();
    let landing=false;
    for(let i=0;i<120*120&&f.manager.snapshot.status==='RUNNING';i++){
      if(source==='AI_MISSION')f.mission.update(1/120);
      else{
        const d=f.manager.snapshot.definition!,objective=f.manager.snapshot.objectives.find(o=>!o.completed)!,target=d.objectives.find(o=>o.id===objective.id)!,p=target.params,s=f.model.state;
        const east=(Number(p.east)-s.position.east),north=(Number(p.north)-s.position.north),land=target.type==='land-zone',up=land?3:Number(p.up);
        if(land&&Math.hypot(east,north)<.15&&Math.hypot(s.velocity.east,s.velocity.north)<.15){f.model.land();landing=true;}
        f.model.update(1/120,landing?neutralInput():{right:Math.max(-.3,Math.min(.3,east*.2)),forward:Math.max(-.3,Math.min(.3,north*.2)),vertical:Math.max(-.7,Math.min(.7,(up-s.position.up)*.6)),yaw:0});
      }
      f.manager.update(1/120,f.model.state,source);
    }
    assert.equal(f.manager.snapshot.status,'COMPLETED',JSON.stringify({challenge:f.manager.snapshot,mission:f.mission.snapshot,flight:f.model.state}));
    assert.equal(f.manager.snapshot.result?.control_source,source);assert.equal(f.repository.list().length,1);assert.equal(f.manager.snapshot.result?.completed_objectives.length,f.manager.snapshot.definition!.objectives.length);
    await f.manager.retry();assert.equal(f.manager.snapshot.status,'READY');assert.equal(f.counts().disposals,1);f.manager.dispose();assert.equal(f.counts().loads,f.counts().disposals);
  });
}
it('pauses countdown and elapsed time, records mixed control transitions and persists abort once',async()=>{
  const f=fixture();await f.manager.select('steady-hover');f.manager.start();f.manager.update(.1,f.model.state,'MANUAL');f.manager.pause();const before=f.manager.snapshot.countdown;
  f.manager.update(.1,f.model.state,'MANUAL');assert.equal(f.manager.snapshot.countdown,before);assert.equal(f.manager.freezesFlight,true);f.manager.resume();
  for(let i=0;i<29;i++)f.manager.update(.1,f.model.state,'MANUAL');f.model.arm();f.manager.update(.1,f.model.state,'MANUAL');f.manager.update(.1,f.model.state,'AI_MISSION');f.manager.update(.1,f.model.state,'MANUAL');
  f.manager.pause();const time=f.manager.snapshot.elapsed;f.manager.update(.1,f.model.state,'MANUAL');assert.equal(f.manager.snapshot.elapsed,time);f.manager.resume();f.manager.abort();f.manager.abort();
  assert.equal(f.manager.snapshot.result?.control_source,'MIXED');assert.deepEqual(f.manager.snapshot.result?.control_history.map(h=>h.source),['MANUAL','AI_MISSION','MANUAL']);assert.equal(f.repository.list().length,1);f.manager.dispose();
});
it('rejects disallowed sources, times out and reports fatal collisions before completion',async()=>{
  const f=fixture();f.registry.register({...CHALLENGE_DEFINITIONS[0],id:'manual-only',allowed_control_modes:['MANUAL'],time_limit:1});await f.manager.select('manual-only');countdown(f);f.manager.update(.1,f.model.state,'AI_MISSION');assert.equal(f.manager.snapshot.status,'FAILED');
  await f.manager.retry();countdown(f);for(let i=0;i<11;i++)f.manager.update(.1,f.model.state,'MANUAL');assert.equal(f.manager.snapshot.status,'FAILED');assert.match(f.manager.snapshot.message,/時間/);
  await f.manager.select('steady-hover');countdown(f);f.manager.update(.1,f.model.state,'MANUAL',[{type:'collision',id:'test-wall'}]);assert.equal(f.manager.snapshot.status,'FAILED');assert.equal(f.manager.snapshot.result?.violations[0].code,'COLLISION');f.manager.dispose();
});
it('scoring is reproducible, provides penalties/bonuses/multiplier and lower-is-better time scores',()=>{
  const c=createChallengeCatalog(),context={completion_time:12,penalty_time:5,completion_rate:1,precision:.8,collected:2,completed:true,violations:[{rule_id:'wall',code:'COLLISION',message:'wall',time:1,penalty:5,fatal:false}]};
  const p=CHALLENGE_DEFINITIONS[0].scoring.params,a=c.scoring.get('points').score(context,p),b=c.scoring.get('points').score(context,p);assert.deepEqual(a,b);assert.ok(a.bonuses.length);assert.equal(a.penalties[0].value,5);
  const doubled=c.scoring.get('points').score(context,{...p,multiplier:2});assert.equal(doubled.final_score,a.final_score*2);assert.equal(c.scoring.get('elapsed-time').score(context,{}).final_score,17);
});
it('handles superseded async loading, load failure and unload idempotently',async()=>{
  const f=fixture();const pending:Array<{resolve:(h:ChallengeSceneHandle)=>void;signal:AbortSignal}>=[];let disposed=0;
  f.manager.setSceneProvider({load:(_d,signal)=>new Promise(resolve=>pending.push({resolve,signal}))});
  const first=f.manager.select('steady-hover'),second=f.manager.select('waypoint-garden');assert.equal(pending[0].signal.aborted,true);
  pending[1].resolve({dispose(){disposed++;}});await second;pending[0].resolve({dispose(){disposed++;}});await first;assert.equal(f.manager.snapshot.definition?.id,'waypoint-garden');assert.equal(disposed,1);
  f.manager.menu();f.manager.menu();assert.equal(disposed,2);
  f.manager.setSceneProvider({async load(){throw new Error('test load failure');}});await f.manager.select('steady-hover');assert.equal(f.manager.snapshot.status,'FAILED');assert.match(f.manager.snapshot.message,/test load failure/);f.manager.dispose();
});
it('seeded scene switching disposes geometries/materials, restores baseline and shares the same scene',async()=>{
  const c=createChallengeCatalog(),scene=new THREE.Scene(),base=new THREE.Group();scene.add(base);scene.background=new THREE.Color('#000000');const original=scene.background,provider=new ThreeChallengeSceneProvider(scene,base,c.scenes),signal=new AbortController().signal;
  const first=await provider.load(c.registry.get('steady-hover'),signal);assert.equal(base.visible,false);const group=scene.getObjectByName('challenge:steady-hover')!;let freed=0;group.traverse(o=>{if(o instanceof THREE.Mesh)o.geometry.addEventListener('dispose',()=>freed++);});
  const second=await provider.load(c.registry.get('waypoint-garden'),signal);assert.ok(freed>0);assert.equal(scene.getObjectByName('challenge:steady-hover'),undefined);assert.ok(scene.getObjectByName('challenge:waypoint-garden'));first.dispose();assert.equal(base.visible,false);second.dispose();second.dispose();assert.equal(base.visible,true);assert.equal(scene.background,original);assert.equal(scene.children.length,1);
  const a=seededRandom(42),b=seededRandom(42);assert.deepEqual(Array.from({length:20},()=>a()),Array.from({length:20},()=>b()));
  const one=c.scenes.get('marker-garden').create(c.registry.get('waypoint-garden')),two=c.scenes.get('marker-garden').create(c.registry.get('waypoint-garden'));assert.deepEqual(one.children.map(o=>o.position.toArray()),two.children.map(o=>o.position.toArray()));
  const {disposeSceneGroup}=await import('../src/challenges/scene');disposeSceneGroup(one);disposeSceneGroup(two);provider.dispose();
});
it('swept collisions catch tunneling and report only entry events',()=>{
  const object=CHALLENGE_DEFINITIONS[1].scene.objects.find(o=>o.id==='building')!,sample=collisionSampler([object]),a=initialState(),b=initialState();a.position={east:-12,north:5,up:2};b.position={east:-2,north:5,up:2};assert.equal(sample(b,a).length,1);
  const inside=initialState();inside.position={...object.position};assert.equal(sample(inside,b).length,1);assert.equal(sample(inside,inside).length,0);
});
it('stores reloadable results, reports quota errors without losing settlement and bounds history',async()=>{
  const map=new Map<string,string>(),storage={getItem:(k:string)=>map.get(k)??null,setItem:(k:string,v:string)=>{map.set(k,v);}} as Storage,repo=new LocalResultRepository(storage),f=fixture(repo);
  await f.manager.select('steady-hover');countdown(f);f.manager.abort();assert.equal(new LocalResultRepository(storage).list().length,1);const result=f.manager.snapshot.result!;
  for(let i=0;i<110;i++)repo.save({...result,attempt_id:String(i)});assert.equal(repo.list().length,100);const copy=repo.list();copy.length=0;assert.equal(repo.list().length,100);
  f.manager.dispose();const bad=fixture({save(){throw new Error('quota');},list(){return [];}});await bad.manager.select('steady-hover');countdown(bad);bad.manager.abort();assert.ok(bad.manager.snapshot.result);assert.match(bad.manager.snapshot.storage_error,/無法寫入/);bad.manager.dispose();
});
