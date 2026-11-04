import { it } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { act,createElement } from 'react';
import { createRoot } from 'react-dom/client';
import * as THREE from 'three';
import { GroundTruthPanel } from '../src/components/GroundTruthPanel';
import { GroundTruthService } from '../src/groundTruth/GroundTruthService';
import { TargetRegistry } from '../src/groundTruth/TargetRegistry';
import { projectionCamera } from '../src/groundTruth/projection';
import { CameraController } from '../src/camera/CameraController';
import type { DroneScene } from '../src/render/DroneScene';
it('developer UI defaults to no overlays, exposes frozen exports and cleans URLs/debug helpers',async()=>{
  const dom=new JSDOM('<div id="root"/>',{url:'http://localhost/?developer=1'}),old={window:globalThis.window,document:globalThis.document};Object.assign(globalThis,{window:dom.window,document:dom.window.document,IS_REACT_ACT_ENVIRONMENT:true});
  const scene=new THREE.Scene(),registry=new TargetRegistry();registry.registerClass({class_id:0,class_name:'car'});const mesh=new THREE.Mesh(new THREE.BoxGeometry(),new THREE.MeshBasicMaterial());mesh.position.z=-5;scene.add(mesh);registry.registerTarget({object_id:'car-a',class_id:0,display_name:'car',mesh_reference:mesh},'test');const gt=new GroundTruthService(registry,scene),camera=new THREE.PerspectiveCamera(60,16/9,.1,100);
  const controller=new CameraController(),prepared=gt.preparePhoto('photo-test',{...projectionCamera(camera,640,360),simulation_time:4,gimbal_pose:controller.snapshot,metadata:{frame_id:1,timestamp:1000,image_width:640,image_height:360,image_source:'threejs-drone-camera',drone_pose:{position:{east:0,north:0,up:0},heading:0,attitude:{pitch:0,roll:0}},camera_pose:{position:{east:0,north:0,up:0},quaternion_scene:[0,0,0,1],rotation_optical_to_enu:[],pitch:0,yaw:0,mode:'body'},camera_intrinsics:{fx:300,fy:300,cx:320,cy:180,vertical_fov_degrees:60,projection:'pinhole'}}});gt.commitPhoto(prepared,new Blob(['png']));
  const flags:boolean[]=[],media={assets:[{id:1,photo_id:'photo-test',name:'photo.png'}]};let loaded=0;
  const mock={internalGroundTruth:gt,payloadCamera:{subscribeStatus:()=>()=>{},getSnapshot:()=>media},setGroundTruthDebug:(flag:boolean)=>flags.push(flag),captureAnnotatedPhoto:async()=>gt.getPhotoSnapshot('photo-test')!} as unknown as DroneScene;
  const create=URL.createObjectURL,revoke=URL.revokeObjectURL;let created=0,revoked=0;URL.createObjectURL=()=>`blob:test-${++created}`;URL.revokeObjectURL=()=>{revoked++;};const root=createRoot(document.getElementById('root')!);
  const render=(canSwitch=true)=>root.render(createElement(GroundTruthPanel,{scene:mock,canSwitch,onLoadTest:()=>{loaded++;},onClearTest(){},onTestFlight(){},onClose(){}}));
  const click=(text:string)=>act(async()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent===text)!;assert.ok(b,text);b.click();});
  try{
    await act(()=>render());assert.equal((document.querySelector('input[type=checkbox]') as HTMLInputElement).checked,false);await click('載入 GT 測試場景（重置飛機）');assert.equal(loaded,1);await click('拍照並計算 GT');
    assert.ok(document.querySelector('img[alt="固定拍攝影像"]'));assert.equal(document.querySelector('svg'),null);assert.equal(document.querySelectorAll('a[download]').length,4);
    await act(()=>document.querySelector<HTMLInputElement>('input[type=checkbox]')!.click());assert.equal(document.querySelectorAll('svg rect').length,1);assert.ok(flags.includes(true));assert.match(document.body.textContent!,/car-a/);
    await act(()=>render(false));assert.equal([...document.querySelectorAll('button')].find(b=>b.textContent==='載入 GT 測試場景（重置飛機）')!.disabled,true);
    await act(()=>root.unmount());assert.equal(flags.at(-1),false);assert.equal(revoked,created);
  }finally{URL.createObjectURL=create;URL.revokeObjectURL=revoke;Object.assign(globalThis,old);dom.window.close();}
});
