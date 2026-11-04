import { it } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import * as THREE from 'three';
import { CameraController } from '../src/camera/CameraController';
import { DroneCamera } from '../src/camera/DroneCamera';
import { TargetRegistry } from '../src/groundTruth/TargetRegistry';
import { GroundTruthService } from '../src/groundTruth/GroundTruthService';
import type { PreparedSnapshot } from '../src/groundTruth/types';
import { FlightModel } from '../src/core/flight';
import { MissionRunner } from '../src/missions/MissionRunner';
import { createChallengeCatalog } from '../src/challenges/catalog';
import { PHOTO_HUNT,HUNT_TARGETS } from '../src/challenges/photoHunt/definition';
import { ChallengeManager } from '../src/challenges/ChallengeManager';
import { MemoryResultRepository } from '../src/challenges/repository';
import { huntCaptureToken,acceptHuntPhoto,type PhotoCaptureToken } from '../src/challenges/photoHunt/bridge';
function fixture(){
  const dom=new JSDOM('<body/>'),old={document:globalThis.document,HTMLCanvasElement:globalThis.HTMLCanvasElement};Object.assign(globalThis,{document:dom.window.document,HTMLCanvasElement:dom.window.HTMLCanvasElement});
  let renders=0,delay=false,prepares=0,active:THREE.WebGLRenderTarget|null=null,physicalWidth=0,physicalHeight=0;const pending:Array<()=>void>=[],tags=new WeakMap<HTMLCanvasElement,{tag:number}>();
  dom.window.HTMLCanvasElement.prototype.getContext=function(){let state=tags.get(this);if(!state){state={tag:0};tags.set(this,state);}return{createImageData:(w:number,h:number)=>({data:new Uint8ClampedArray(w*h*4)}),putImageData(image:{data:Uint8Array}){state!.tag=image.data[0];},drawImage(source:HTMLCanvasElement){state!.tag=tags.get(source)!.tag;}} as never;};
  dom.window.HTMLCanvasElement.prototype.toBlob=function(callback){const encode=()=>callback(new Blob([String(tags.get(this)!.tag)],{type:'image/png'}));if(delay)pending.push(encode);else queueMicrotask(encode);};
  const renderer={getContext:()=>({isContextLost:()=>false}),getRenderTarget:()=>active,getViewport:(v:THREE.Vector4)=>v,getScissor:(v:THREE.Vector4)=>v,getScissorTest:()=>false,setRenderTarget(target:THREE.WebGLRenderTarget|null){active=target;if(target){physicalWidth=target.viewport.z;physicalHeight=target.viewport.w;}},setViewport(_x:number,_y:number,w:number,h:number){physicalWidth=w*2;physicalHeight=h*2;},setScissor(){},setScissorTest(){},render(){if(active){assert.equal(physicalWidth,active.width,'DPR must not scale sensor viewport');assert.equal(physicalHeight,active.height);}renders++;},readRenderTargetPixels(_t:unknown,_x:number,_y:number,_w:number,_h:number,p:Uint8Array){p.fill(renders);}} as unknown as THREE.WebGLRenderer;
  const scene=new THREE.Scene(),body=new THREE.Group();body.position.y=8;scene.add(body);
  const target=new THREE.Mesh(new THREE.BoxGeometry(2,1,2),new THREE.MeshStandardMaterial());target.position.set(1,.5,-2);target.userData.annotationTarget={object_id:'car-a',class_id:0,display_name:'Car'};scene.add(target);
  const registry=new TargetRegistry();registry.registerClass({class_id:0,class_name:'car'});const service=new GroundTruthService(registry,scene);service.activateScene('snapshot-scene',scene);
  const controller=new CameraController();controller.setMode('stabilized');controller.setView('nadir');controller.setResolution(320,180);
  const camera=new DroneCamera(controller,renderer,scene,body);camera.setPhotoObserver({prepare:(id,state)=>{prepares++;return service.preparePhoto(id,state);},commit:(_id,p,image)=>service.commitPhoto(p as PreparedSnapshot,image),remove:id=>service.removePhoto(id)});
  const pose={position:{east:0,north:0,up:8},heading:0,attitude:{pitch:0,roll:0}};camera.update(pose,performance.now(),7);
  return{camera,controller,scene,body,target,registry,service,pose,pending,setDelay:(value:boolean)=>{delay=value;},counts:()=>({renders,prepares}),dispose:()=>{camera.dispose();service.dispose();Object.assign(globalThis,old);dom.window.close();}};
}
it('offscreen sensor rendering uses physical render-target pixels even at DPR 2',async()=>{const f=fixture();try{await f.camera.capturePhoto();assert.equal(f.counts().renders,1);}finally{f.dispose();}});
it('freezes image pixels, camera matrices, target poses and simulation time before delayed PNG encoding',async()=>{
  const f=fixture();try{
    f.setDelay(true);const promise=f.camera.capturePhoto();await Promise.resolve();assert.equal(f.pending.length,1);assert.equal(f.counts().prepares,1);
    f.body.position.x=5;f.pose.position.east=5;f.target.position.x=9;f.controller.setAngle('yaw',45);f.camera.update(f.pose,performance.now()+200,12);f.service.activateScene('next-scene',new THREE.Group());
    f.setDelay(false);const publicFrame=await f.camera.getFrame();assert.equal('object_annotations'in publicFrame,false);assert.equal(await(publicFrame.pixels as Blob).text(),'2');
    f.pending.shift()!();const id=await promise,snapshot=f.service.getPhotoSnapshot(id)!;assert.equal(await snapshot.image_data.text(),'1');assert.equal(snapshot.frame_id,1);assert.equal(snapshot.scene_id,'snapshot-scene');assert.equal(snapshot.simulation_time,7);assert.equal(snapshot.drone_pose.position.east,0);assert.equal(snapshot.object_annotations[0].world_position.east,1);assert.equal(snapshot.gimbal_pose.yaw,0);
    assert.equal(f.camera.getSnapshot().assets[0].photo_id,id);assert.equal('object_annotations'in f.camera.getSnapshot().assets[0],false);assert.equal(f.registry.getTargets().length,0);assert.deepEqual(f.service.getPhotoAnnotations(id),snapshot.object_annotations);
  }finally{f.dispose();}
});
it('normal preview/getFrame does not trigger GT raycasting, and asset eviction/removal cleans snapshots',async()=>{
  const f=fixture();try{
    f.controller.setEnabled(true);for(let i=0;i<5;i++)f.camera.update(f.pose,performance.now()+i*100,7+i*.1);await f.camera.getFrame();assert.equal(f.counts().prepares,0);
    const ids:string[]=[];for(let i=0;i<10;i++)ids.push(await f.camera.capturePhoto());assert.equal(new Set(ids).size,10);assert.equal(f.camera.getSnapshot().assets.length,8);assert.equal(f.service.getPhotoSnapshot(ids[0]),null);assert.ok(f.service.getPhotoSnapshot(ids[9]));
    f.camera.deleteAsset(f.camera.getSnapshot().assets[0].id);assert.equal(f.service.getPhotoSnapshot(ids[2]),null);
  }finally{f.dispose();}
});
it('cancels pending captures without committing partial snapshots and preserves photos if annotation fails',async()=>{
  const f=fixture();try{
    const abort=new AbortController();f.setDelay(true);const promise=f.camera.capturePhoto(abort.signal);await Promise.resolve();abort.abort();f.pending.shift()!();await assert.rejects(promise,/取消/);assert.equal(f.camera.getSnapshot().assets.length,0);
    f.setDelay(false);f.camera.setPhotoObserver({prepare(){throw new Error('test annotation failure');},commit(){throw new Error('must not commit');},remove(){}});await f.camera.capturePhoto();assert.equal(f.camera.getSnapshot().assets.length,1);assert.match(f.camera.getSnapshot().message,/標註失敗/);
  }finally{f.dispose();}
});
it('mission capture_photo uses the real shared camera after physics/scene commit, alongside manual captures',async()=>{
  const f=fixture();try{
    const model=new FlightModel(),runner=new MissionRunner(model);runner.setCameraPort(f.camera);assert.deepEqual(runner.load({version:'1.2',commands:[{action:'takeoff',altitude:3},{action:'set_camera_view',view:'nadir',mode:'stabilized'},{action:'capture_photo'},{action:'land'}]}),[]);assert.ok(runner.start());
    for(let i=0;i<120*90&&runner.ownsControl;i++){
      runner.update(1/120);const s=model.state;f.body.position.set(s.position.east,s.position.up,-s.position.north);f.camera.update({position:{...s.position},heading:s.heading,attitude:{...s.attitude}},i*1000/120,model.simulationTime);await Promise.resolve();
    }
    assert.equal(runner.snapshot.status,'completed',runner.snapshot.message);assert.equal(f.camera.getSnapshot().assets.length,1);const id=f.camera.getSnapshot().assets[0].photo_id!,snapshot=f.service.getPhotoSnapshot(id)!;assert.ok(snapshot.simulation_time>0);assert.ok(snapshot.drone_pose.position.up>2.7);assert.equal(snapshot.object_annotations.length,1);assert.ok(snapshot.object_annotations[0].is_in_frame);
    const manual=await f.camera.capturePhoto();assert.notEqual(manual,id);assert.ok(f.service.getPhotoSnapshot(manual));assert.equal(f.counts().prepares,2);
  }finally{f.dispose();}
});
it('photo challenge scores the shutter snapshot after delayed PNG encoding and a pause, not the new camera/target pose',async()=>{
  const f=fixture(),catalog=createChallengeCatalog(),definition=structuredClone(PHOTO_HUNT);definition.id='snapshot-scene';const target=structuredClone(HUNT_TARGETS[0]);target.object_id='car-a';target.scoring_config.min_area=.001;definition.objectives[0].params.targets=[target];definition.scoring.params.target_count=1;catalog.registry.register(definition);const model=new FlightModel();let attempt=0;const manager=new ChallengeManager(catalog.registry,catalog.rules,catalog.scoring,new MemoryResultRepository(),{initialize:d=>model.reset(d.spawn),stop(){}},undefined,()=>`photo-${++attempt}`);manager.setSceneProvider({async load(){return{dispose(){}};}});
  try{
    await manager.select(definition.id);manager.start();for(let i=0;i<30;i++)manager.update(.1,model.state,'MANUAL');model.arm();
    f.camera.setPhotoObserver({prepare:(id,state)=>({snapshot:f.service.preparePhoto(id,state),token:huntCaptureToken(manager)}),commit:(_id,prepared,image)=>{const p=prepared as {snapshot:PreparedSnapshot;token:PhotoCaptureToken};f.service.commitPhoto(p.snapshot,image);acceptHuntPhoto(manager,{...p.snapshot,image_data:image},p.token);},remove:id=>f.service.removePhoto(id)});
    f.setDelay(true);const capture=f.camera.capturePhoto();await Promise.resolve();manager.pause();f.target.position.x=100;f.controller.setAngle('yaw',90);f.body.position.x=30;f.camera.update({...f.pose,position:{east:30,north:0,up:8}},performance.now()+1000,20);f.pending.shift()!();const id=await capture;
    assert.equal(manager.snapshot.status,'PAUSED');manager.resume();manager.update(.1,model.state,'MANUAL');assert.equal(manager.snapshot.status,'COMPLETED');assert.equal(f.service.getPhotoSnapshot(id)!.simulation_time,7);assert.ok(f.service.getPhotoAnnotations(id)![0].world_position.east<2);
    const oldToken=huntCaptureToken(manager);await manager.retry();manager.start();for(let i=0;i<30;i++)manager.update(.1,model.state,'MANUAL');assert.equal(acceptHuntPhoto(manager,f.service.getPhotoSnapshot(id)!,oldToken),false);
  }finally{manager.dispose();f.dispose();}
});
