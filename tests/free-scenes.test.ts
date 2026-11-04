import { it } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createFreeSceneCatalog } from '../src/scenes/catalog';
import { FreeSceneManager,asSceneDefinition } from '../src/scenes/FreeFlightScenes';
import { ThreeChallengeSceneProvider } from '../src/challenges/scene';
import { TargetRegistry } from '../src/groundTruth/TargetRegistry';
import { GroundTruthService } from '../src/groundTruth/GroundTruthService';
import { DEFAULT_TARGET_CLASSES } from '../src/groundTruth/testScene';
import { FlightModel,neutralInput } from '../src/core/flight';
import { MissionRunner } from '../src/missions/MissionRunner';
import { createChallengeCatalog } from '../src/challenges/catalog';
import { JSDOM } from 'jsdom';
import { act,createElement } from 'react';
import { SceneSelector } from '../src/components/SceneSelector';

function setup(){
  const catalog=createFreeSceneCatalog(),scene=new THREE.Scene(),base=new THREE.Group();scene.add(base);
  const targets=new TargetRegistry();for(const c of [...DEFAULT_TARGET_CLASSES,{class_id:5,class_name:'tree'}])targets.registerClass(c);
  const gt=new GroundTruthService(targets,scene),model=new FlightModel('calm'),runner=new MissionRunner(model);
  const provider=new ThreeChallengeSceneProvider(scene,base,catalog.factories,{loaded:(d,g)=>gt.activateScene(d.id,g)});
  const manager=new FreeSceneManager(catalog,provider,{before:()=>runner.stop(),initialize:d=>{runner.reset();model.setFlightBounds({radius:d.flight_bounds.radius,maxAltitude:d.max_altitude});model.reset({position:d.spawn_position,heading:d.spawn_heading});}});
  return{catalog,scene,base,targets,gt,model,runner,manager,provider};
}
it('all four scenes load, reset spawn/bounds, isolate Ground Truth, and support shared-physics missions',async()=>{
  const f=setup();try{for(const d of f.catalog.listScenes()){
    assert.ok(await f.manager.loadScene(d.id));assert.equal(f.manager.getSnapshot().status,'ACTIVE');assert.deepEqual(f.model.state.position,d.spawn_position);assert.equal(f.model.flightBounds.radius,d.flight_bounds.radius);assert.equal(f.gt.sceneId,d.id);
    assert.ok(f.targets.getTargets().every(t=>t.scope_id===d.id));
    const ids=f.targets.getTargets().map(t=>t.object_id);assert.equal(new Set(ids).size,ids.length);
    assert.deepEqual(f.runner.load({commands:[{action:'takeoff',altitude:5},{action:'hover',duration:1},{action:'land'}]}),[]);assert.ok(f.runner.start());for(let i=0;i<18000&&f.runner.ownsControl;i++)f.runner.update(1/120);assert.equal(f.runner.snapshot.status,'completed',d.id);
  }}finally{f.manager.dispose();f.provider.dispose();f.gt.dispose();}
});
it('switch cancels an active mission and rejects routes beyond scene-specific limits',async()=>{
  const f=setup();try{
    await f.manager.loadScene('training');f.runner.load({commands:[{action:'takeoff',altitude:18},{action:'land'}]});assert.equal(f.runner.start(),false);assert.match(f.runner.snapshot.message,/場景/);
    f.runner.load({commands:[{action:'takeoff',altitude:5},{action:'hover',duration:20},{action:'land'}]});assert.ok(f.runner.start());f.runner.update(.1);await f.manager.switchScene('forest');assert.equal(f.runner.ownsControl,false);assert.equal(f.model.state.mode,'grounded');
    f.model.arm();for(let i=0;i<400;i++)f.model.update(.1,{...neutralInput(),vertical:1,forward:1});assert.ok(f.model.state.position.up<=20);assert.ok(Math.hypot(f.model.state.position.east,f.model.state.position.north)<=40+1e-8);
  }finally{f.manager.dispose();}
});
it('latest asynchronous selection wins and late resources are disposed',async()=>{
  const f=setup();let release!:(g:THREE.Group)=>void,disposed=0;
  f.catalog.factories.register('slow',{schema:{type:'object'},create:()=>new THREE.Group(),load:()=>new Promise(resolve=>{release=resolve;})});
  const definition=f.catalog.get('training');f.catalog.registerScene({...definition,id:'slow',scene:{...definition.scene,type:'slow'}});
  try{await f.manager.loadScene('training');const slow=f.manager.switchScene('slow');await f.manager.switchScene('exam');
    const group=new THREE.Group(),geometry=new THREE.BoxGeometry();geometry.addEventListener('dispose',()=>disposed++);group.add(new THREE.Mesh(geometry,new THREE.MeshBasicMaterial()));release(group);assert.equal(await slow,false);assert.equal(f.manager.getActiveScene()?.id,'exam');assert.equal(disposed,1);
  }finally{f.manager.dispose();}
});
it('load failure restores previous scene, and repeated unload disposes resources without accumulating roots',async()=>{
  const f=setup();let disposed=0;
  try{await f.manager.loadScene('training');f.catalog.factories.register('broken',{schema:{type:'object'},create:()=>{throw new Error('test load failure');}});const d=f.catalog.get('training');f.catalog.registerScene({...d,id:'broken',scene:{...d.scene,type:'broken'}});
    assert.equal(await f.manager.switchScene('broken'),false);assert.equal(f.manager.getSnapshot().status,'ACTIVE');assert.equal(f.gt.sceneId,'training');assert.match(f.manager.getSnapshot().error,/failure/);
    for(let i=0;i<12;i++){await f.manager.switchScene(i%2?'urban':'forest');assert.equal(f.scene.children.length,2);f.scene.traverse(o=>{if(o instanceof THREE.Mesh)o.geometry.addEventListener('dispose',()=>disposed++);});}
    f.manager.unloadScene();assert.equal(f.targets.getTargets().length,0);assert.equal(f.scene.children.length,1);assert.ok(disposed>100);
    f.catalog.unregisterScene('broken');assert.throws(()=>f.catalog.get('broken'));
  }finally{f.manager.dispose();}
});
it('challenge provider shares factories, restores the selected free scene, and does not replace aircraft services',async()=>{
  const f=setup();try{await f.manager.loadScene('forest');const freeRoot=f.scene.children.find(o=>o!==f.base)!;const catalog=createChallengeCatalog();const provider=new ThreeChallengeSceneProvider(f.scene,freeRoot as THREE.Group,catalog.scenes,{loaded:(d,g)=>{const cleanup=f.gt.activateScene(d.id,g);return()=>{cleanup();f.gt.activateScene('forest',freeRoot);};}});
    const d=catalog.registry.get('precision-landing');const handle=await provider.load(d,new AbortController().signal);assert.equal(freeRoot.visible,false);assert.equal(f.gt.sceneId,d.id);handle.dispose();assert.equal(freeRoot.visible,true);assert.equal(f.gt.sceneId,'forest');assert.ok(f.targets.getTargets().every(t=>t.scope_id==='forest'));provider.dispose();
  }finally{f.manager.dispose();}
});
it('selector requires explicit in-flight confirmation and exposes four touch-sized scene cards',async()=>{
  const f=setup();await f.manager.loadScene('training');const dom=new JSDOM('<div id="root"></div>');Object.assign(globalThis,{window:dom.window,document:dom.window.document,IS_REACT_ACT_ENVIRONMENT:true});const {createRoot}=await import('react-dom/client');const root=createRoot(document.getElementById('root')!);let closed=false;
  try{await act(()=>root.render(createElement(SceneSelector,{manager:f.manager,needsConfirmation:true,onClose:()=>{closed=true;}})));assert.equal(document.querySelectorAll('.scene-cards button').length,4);
    await act(()=>{(document.querySelectorAll('.scene-cards button')[2] as HTMLButtonElement).click();});
    const click=async(text:string)=>act(async()=>{[...document.querySelectorAll('button')].find(b=>b.textContent===text)!.click();await new Promise(r=>setTimeout(r,0));});
    await click('開始飛行');assert.equal(f.manager.getActiveScene()?.id,'training');assert.match(document.body.textContent!,/是否繼續/);await click('確認切換');assert.equal(f.manager.getActiveScene()?.id,'forest');assert.ok(closed);
  }finally{await act(()=>root.unmount());dom.window.close();f.manager.dispose();}
});

it('exam manual flight reaches 50m altitude and 60m radius without changing other scenes or mission limits',async()=>{
  const f=setup();try{
    await f.manager.loadScene('exam');assert.deepEqual(f.model.flightBounds,{radius:60,maxAltitude:50});
    f.model.arm();for(let i=0;i<400;i++)f.model.update(.1,{...neutralInput(),vertical:1});assert.ok(f.model.state.position.up>49.9);assert.ok(f.model.state.position.up<=50);
    for(let i=0;i<300;i++)f.model.update(.1,{...neutralInput(),forward:1});assert.ok(Math.hypot(f.model.state.position.east,f.model.state.position.north)>59.9);assert.ok(Math.hypot(f.model.state.position.east,f.model.state.position.north)<=60+1e-8);
    await f.manager.switchScene('training');assert.deepEqual(f.model.flightBounds,{radius:35,maxAltitude:15});
    assert.ok(f.runner.load({commands:[{action:'takeoff',altitude:50},{action:'land'}]}).length>0);
  }finally{f.manager.dispose();}
});
