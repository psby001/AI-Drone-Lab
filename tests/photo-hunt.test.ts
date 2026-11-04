import { it } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createChallengeCatalog } from '../src/challenges/catalog';
import { PHOTO_HUNT,HUNT_TARGETS,selectHuntSpawns } from '../src/challenges/photoHunt/definition';
import { photoHuntScene } from '../src/challenges/photoHunt/scene';
import { evaluatePhoto,photoQuality,DEFAULT_PHOTO_SCORE as C } from '../src/challenges/photoHunt/scoring';
import { PhotoHuntRule,readHuntProgress,type PhotoFeedback } from '../src/challenges/photoHunt/rule';
import { huntCaptureToken,acceptHuntPhoto } from '../src/challenges/photoHunt/bridge';
import { TargetRegistry } from '../src/groundTruth/TargetRegistry';
import { GroundTruthService } from '../src/groundTruth/GroundTruthService';
import { DEFAULT_TARGET_CLASSES } from '../src/groundTruth/testScene';
import { projectionCamera } from '../src/groundTruth/projection';
import { CameraController } from '../src/camera/CameraController';
import { cameraOrientation,matrixIntrinsics } from '../src/camera/pose';
import type { CameraSnapshot,ObjectAnnotation } from '../src/groundTruth/types';
import { disposeSceneGroup,ThreeChallengeSceneProvider,collisionSampler } from '../src/challenges/scene';
import { ChallengeManager } from '../src/challenges/ChallengeManager';
import { MemoryResultRepository,personalBests,LocalResultRepository,betterResult } from '../src/challenges/repository';
import { FlightModel,initialState } from '../src/core/flight';
import { MissionRunner } from '../src/missions/MissionRunner';
import type { ControlSource } from '../src/challenges/types';
function sceneFixture(seed=985){
  const definition=structuredClone(PHOTO_HUNT);definition.scene.seed=seed;const root=photoHuntScene.create(definition),scene=new THREE.Scene();scene.add(root);const registry=new TargetRegistry();DEFAULT_TARGET_CLASSES.forEach(c=>registry.registerClass(c));const gt=new GroundTruthService(registry,scene);gt.activateScene(definition.id,root);
  const camera=new THREE.PerspectiveCamera(70,1280/720,.025,180),controller=new CameraController();controller.setMode('stabilized');controller.setView('nadir');let count=0;
  function photo(east:number,north:number,up:number,heading=0){camera.position.set(east,up,-north);camera.quaternion.copy(cameraOrientation(new THREE.Quaternion(),controller.snapshot,heading));const projection=projectionCamera(camera,1280,720);const snapshot:CameraSnapshot={...projection,photo_id:`photo-${++count}`,frame_id:count,timestamp:count,simulation_time:count,image_source:'threejs-drone-camera',image_data:new Blob(['test']),camera_intrinsics:matrixIntrinsics(camera.projectionMatrix,1280,720),drone_pose:{position:{east,north,up},heading,attitude:{pitch:0,roll:0}},gimbal_pose:controller.snapshot,scene_id:definition.id,object_annotations:gt.generateFrameGroundTruth(projection)};return snapshot;}
  return{definition,root,scene,registry,gt,camera,controller,photo,dispose:()=>{gt.dispose();disposeSceneGroup(root);}};
}
function idealPhoto():CameraSnapshot {return{photo_id:'ideal',timestamp:10,scene_id:PHOTO_HUNT.id,object_annotations:HUNT_TARGETS.map(t=>({object_id:t.object_id,class_name:t.class_name,is_in_frame:true,is_valid_annotation:true,bounding_box_2d:{x:0,y:0,width:10,height:10},visibility_ratio:1,in_frame_ratio:1,visible_area_ratio:.2,normalized_center:{x:.5,y:.5}} as ObjectAnnotation))} as CameraSnapshot;}
function observation(events:unknown[]=[],time=10){return{drone:initialState(),previous:null,dt:.1,simulation_time:time,events:events as never[]};}
it('registers formal photo challenge with validated configurable schemas, different scene and score',()=>{
  const c=createChallengeCatalog();assert.equal(c.registry.list().length,3);assert.equal(c.registry.get(PHOTO_HUNT.id).time_limit,300);const bad=structuredClone(PHOTO_HUNT);(bad.objectives[0].params.targets as typeof HUNT_TARGETS)[0].scoring_config.ideal_area_min=.01;assert.throws(()=>c.registry.register({...bad,id:'bad-hunt'}));
});
it('seeded candidate placement is stable, supports fixed layout, and separates regions',()=>{
  assert.deepEqual(selectHuntSpawns(HUNT_TARGETS,42),selectHuntSpawns(HUNT_TARGETS,42));const layouts=new Set(Array.from({length:20},(_,seed)=>JSON.stringify(selectHuntSpawns(HUNT_TARGETS,seed))));assert.ok(layouts.size>1);
  assert.deepEqual(selectHuntSpawns(HUNT_TARGETS,2,false).map(s=>s.position),HUNT_TARGETS.map(t=>t.spawn_candidates[0]));for(const a of HUNT_TARGETS)for(const b of HUNT_TARGETS)if(a!==b)assert.ok(Math.hypot(a.spawn_candidates[0].east-b.spawn_candidates[0].east,a.spawn_candidates[0].north-b.spawn_candidates[0].north)>15);
});
it('all seeded targets have legal effective photos from public search locations, but not from launch',()=>{
  const seen=new Set<string>();
  for(const seed of [0,1,2,3,4,5,985]){const f=sceneFixture(seed);try{
    assert.equal(f.registry.getTargets().length,3);f.controller.setView('fpv');const launch=f.photo(0,-24,.4);assert.ok(HUNT_TARGETS.filter(t=>evaluatePhoto(launch,t,true).is_valid).length<3);f.controller.setView('nadir');
    for(const [i,p] of [[-16,5],[14,16],[17,-10]].entries()){
      const snapshot=f.photo(p[0],p[1]+.34,i===2?9:6),target=HUNT_TARGETS[i],e=evaluatePhoto(snapshot,target,true);assert.ok(e.is_valid,JSON.stringify({seed,target:target.object_id,e,annotation:snapshot.object_annotations[i]}));
      const position=f.registry.getTargets().find(t=>t.object_id===target.object_id)!.world_position;seen.add(`${target.object_id}:${position.east}:${position.north}`);
    }
    assert.ok(f.root.children.some(o=>o instanceof THREE.InstancedMesh));
  }finally{f.dispose();}}
  assert.equal(seen.size,6,'both candidates for each target must be exercised');
});
it('photo validity has inclusive independent boundaries, rejects hidden and tiny objects, and respects capture status',()=>{
  const s=idealPhoto(),a=s.object_annotations[0],target=HUNT_TARGETS[0];Object.assign(a,{visibility_ratio:.2,in_frame_ratio:.2,visible_area_ratio:.03});assert.ok(evaluatePhoto(s,target,true).is_valid);
  for(const key of ['visibility_ratio','in_frame_ratio','visible_area_ratio'] as const){const old=a[key];a[key]=old-.00001;assert.equal(evaluatePhoto(s,target,true).is_valid,false,key);a[key]=old;}
  assert.equal(evaluatePhoto(s,target,false).is_valid,false);a.visibility_ratio=0;a.is_valid_annotation=false;assert.equal(evaluatePhoto(s,target,true).total_score,0);a.visibility_ratio=NaN;assert.equal(evaluatePhoto(s,target,true).is_valid,false);
});
it('continuous size curve and normalized composition are independent of resolution; occlusion reduces score',()=>{
  const sample={visibility_ratio:1,in_frame_ratio:1,visible_area_ratio:.2,normalized_center:{x:.5,y:.5}};
  assert.deepEqual(photoQuality(sample,C),{visibility_score:40,composition_score:30,size_score:30});
  assert.ok(photoQuality({...sample,visibility_ratio:.8},C).visibility_score<40);assert.ok(photoQuality({...sample,normalized_center:{x:.9,y:.9}},C).composition_score<30);
  for(const boundary of [.03,.15,.30])assert.ok(Math.abs(photoQuality({...sample,visible_area_ratio:boundary-1e-8},C).size_score-photoQuality({...sample,visible_area_ratio:boundary+1e-8},C).size_score)<.001);
  assert.ok(photoQuality({...sample,visible_area_ratio:.8},C).size_score<30);
});
it('one photo can finish three targets; duplicates cannot replace other targets, best scores never regress',()=>{
  const rule=new PhotoHuntRule({targets:HUNT_TARGETS}),s=idealPhoto();const send=(id:string,indices:number[],area=.2)=>{s.photo_id=id;s.object_annotations.forEach(a=>a.visible_area_ratio=area);const feedback:PhotoFeedback={photo_id:id,timestamp:10,elapsed:2,evaluations:indices.map(i=>evaluatePhoto(s,HUNT_TARGETS[i],true))};return rule.evaluate(observation([{type:'camera',id:'photo-hunt-evaluated',data:{feedback}}]));};
  assert.equal(send('a',[0]).complete,false);assert.equal(send('a',[0]).collected,1);assert.equal(send('b',[0],.03).complete,false);assert.equal(readHuntProgress(rule.metrics()).best[HUNT_TARGETS[0].object_id].total_score,100);assert.equal(send('c',[0,1,2]).complete,true);assert.equal(readHuntProgress(rule.metrics()).shot_count,3);
});
it('actual walls and gimbal direction affect photo validation through unchanged Step 9 geometry',()=>{
  const f=sceneFixture();try{const target=selectHuntSpawns(HUNT_TARGETS,985)[0].position,s=f.photo(-16,5.34,6),a=s.object_annotations[0];assert.ok(a.visibility_ratio>=.7);
    const wall=new THREE.Mesh(new THREE.BoxGeometry(5,.2,6),new THREE.MeshStandardMaterial());wall.position.set(target.east,3,-target.north);f.scene.add(wall);const blocked=f.photo(target.east,target.north,6);assert.equal(evaluatePhoto(blocked,HUNT_TARGETS[0],true).is_valid,false);assert.equal(blocked.object_annotations[0].visibility_ratio,0);f.scene.remove(wall);wall.geometry.dispose();(wall.material as THREE.Material).dispose();
    f.controller.setView('fpv');assert.equal(evaluatePhoto(f.photo(-16,5.34,6),HUNT_TARGETS[0],true).is_valid,false);
  }finally{f.dispose();}
});
function managerFixture(){const catalog=createChallengeCatalog(),model=new FlightModel(),runner=new MissionRunner(model),repository=new MemoryResultRepository();let id=0;const manager=new ChallengeManager(catalog.registry,catalog.rules,catalog.scoring,repository,{initialize:d=>{runner.reset();model.reset(d.spawn);},stop:()=>{runner.stop();model.holdPosition();}},undefined,()=>`hunt-${++id}`);manager.setSceneProvider({async load(d){return{sample:collisionSampler([...d.scene.objects,...(photoHuntScene.colliders?.(d)??[])]),dispose(){}};}});return{catalog,model,runner,repository,manager};}
async function start(f:ReturnType<typeof managerFixture>){await f.manager.select(PHOTO_HUNT.id);f.manager.start();for(let i=0;i<30;i++)f.manager.update(.1,f.model.state,'MANUAL');assert.equal(f.manager.snapshot.status,'RUNNING');}
it('snapshot shutter token prevents pre-start, paused, old-attempt and scene-switch contamination',async()=>{
  const f=managerFixture();await f.manager.select(PHOTO_HUNT.id);assert.equal(acceptHuntPhoto(f.manager,idealPhoto(),huntCaptureToken(f.manager)),false);f.manager.start();for(let i=0;i<30;i++)f.manager.update(.1,f.model.state,'MANUAL');const token=huntCaptureToken(f.manager);f.manager.pause();assert.equal(acceptHuntPhoto(f.manager,idealPhoto(),huntCaptureToken(f.manager)),false);assert.equal(acceptHuntPhoto(f.manager,idealPhoto(),token),true);f.manager.resume();f.model.arm();f.manager.update(.1,f.model.state,'MANUAL');assert.equal(f.manager.snapshot.status,'COMPLETED');await f.manager.retry();assert.equal(f.manager.snapshot.metrics.treasures.found,0);f.manager.start();for(let i=0;i<30;i++)f.manager.update(.1,f.model.state,'MANUAL');assert.equal(acceptHuntPhoto(f.manager,idealPhoto(),token),false);f.manager.menu();assert.equal(f.manager.snapshot.status,'IDLE');f.manager.dispose();
});
it('timeout keeps partial photo scores, ranking uses higher scores and results survive storage',async()=>{
  const f=managerFixture();await start(f);const s=idealPhoto();s.object_annotations=s.object_annotations.slice(0,1);acceptHuntPhoto(f.manager,s,huntCaptureToken(f.manager));f.model.arm();f.manager.update(.1,f.model.state,'MANUAL');for(let i=0;i<3001&&f.manager.snapshot.status==='RUNNING';i++)f.manager.update(.1,f.model.state,'MANUAL');assert.equal(f.manager.snapshot.status,'FAILED');assert.equal(f.manager.snapshot.result?.final_score,33.33);assert.equal(readHuntProgress(f.manager.snapshot.result?.metrics?.treasures).found,1);
  await f.manager.retry();f.manager.start();for(let i=0;i<30;i++)f.manager.update(.1,f.model.state,'MANUAL');acceptHuntPhoto(f.manager,idealPhoto(),huntCaptureToken(f.manager));f.model.arm();f.manager.update(.1,f.model.state,'MANUAL');const result=f.manager.snapshot.result!;assert.equal(result.score_direction,'higher');assert.equal(result.final_score,100);assert.equal(personalBests(f.repository.list(),PHOTO_HUNT)[0].final_score,100);
  const map=new Map<string,string>(),storage={getItem:(k:string)=>map.get(k)??null,setItem:(k:string,v:string)=>{map.set(k,v);},get length(){return map.size;},clear:()=>map.clear(),removeItem:(k:string)=>{map.delete(k);},key:(i:number)=>[...map.keys()][i]??null};new LocalResultRepository(storage).save(result);assert.equal(new LocalResultRepository(storage).list()[0].metrics?.treasures.found,3);f.manager.dispose();
});
for(const source of ['MANUAL','AI_MISSION','MIXED'] as ControlSource[])it(`public-region route completes with existing FlightModel / MissionRunner: ${source}`,async()=>{
  const f=managerFixture(),world=sceneFixture();await start(f);let photoCount=0;
  const shoot=()=>{const p=f.model.state.position,s=world.photo(p.east,p.north+.34,p.up),token=huntCaptureToken(f.manager);assert.ok(s.object_annotations.some(a=>evaluatePhoto(s,HUNT_TARGETS.find(t=>t.object_id===a.object_id)!,true).is_valid),JSON.stringify(s.object_annotations.map(a=>({id:a.object_id,vis:a.visibility_ratio,frame:a.in_frame_ratio,area:a.visible_area_ratio}))));assert.ok(acceptHuntPhoto(f.manager,s,token));photoCount++;};
  f.runner.setCameraPort({execute(command){if(command.action==='capture_photo')shoot();else if(command.action==='set_camera_view'){world.controller.setView(command.view);if(command.mode)world.controller.setMode(command.mode);}},cancel(){}});
  assert.deepEqual(f.runner.load(PHOTO_HUNT.metadata.example_mission),[]);
  let region=0,manual=source==='MANUAL';if(manual)f.model.arm();else f.runner.start();
  const regions=[[-16,5,6],[14,16,6],[17,-10,9]];
  for(let i=0;i<120*170&&f.manager.snapshot.status==='RUNNING';i++){
    if(source==='MIXED'&&!manual&&photoCount===1){f.runner.stop();manual=true;region=1;}
    if(manual){const p=f.model.state.position,[e,n,alt]=regions[region],clamp=(v:number)=>Math.max(-.65,Math.min(.65,v));f.model.update(1/120,{right:clamp((e-p.east)*.3),forward:clamp((n-p.north)*.3),vertical:clamp((alt-p.up)*.6),yaw:0});if(Math.hypot(p.east-e,p.north-n)<.12&&Math.abs(p.up-alt)<.1&&Math.hypot(f.model.state.velocity.east,f.model.state.velocity.north)<.1){shoot();region=Math.min(2,region+1);}}
    else f.runner.update(1/120);
    f.manager.update(1/120,f.model.state,manual?'MANUAL':'AI_MISSION');await Promise.resolve();
  }
  assert.equal(f.manager.snapshot.status,'COMPLETED',JSON.stringify({challenge:f.manager.snapshot,mission:f.runner.snapshot}));assert.equal(f.manager.snapshot.result?.control_source,source);assert.ok(photoCount>=3);world.dispose();f.manager.dispose();
});
it('scene lifecycle clears Step 9 targets on retry and switching back to other formal challenges',async()=>{
  const f=sceneFixture(),c=createChallengeCatalog(),base=new THREE.Group();f.scene.remove(f.root);disposeSceneGroup(f.root);f.scene.add(base);let clean=0;
  const provider=new ThreeChallengeSceneProvider(f.scene,base,c.scenes,{loaded:(d,group)=>{const off=f.gt.activateScene(d.id,group);return()=>{off();clean++;};}});
  const a=await provider.load(PHOTO_HUNT,new AbortController().signal);assert.equal(f.registry.getTargets().length,3);a.dispose();assert.equal(f.registry.getTargets().length,0);const b=await provider.load(c.registry.get('precision-landing'),new AbortController().signal);assert.equal(f.registry.getTargets().length,0);b.dispose();assert.equal(clean,2);provider.dispose();f.gt.dispose();
});
it('equal photography scores rank by completion time without reversing the higher-score direction',()=>{
  assert.ok(betterResult({final_score:90,score_direction:'higher',completion_time:20},{final_score:90,completion_time:30}));assert.ok(!betterResult({final_score:89,score_direction:'higher',completion_time:1},{final_score:90,completion_time:30}));
});
