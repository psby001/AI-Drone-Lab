import { it } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { TargetRegistry,boxCorners } from '../src/groundTruth/TargetRegistry';
import { projectTargetToCamera,projectionCamera } from '../src/groundTruth/projection';
import { GroundTruthService,exportYolo } from '../src/groundTruth/GroundTruthService';
import { DEFAULT_TARGET_CLASSES,createGroundTruthTestScene } from '../src/groundTruth/testScene';
import { comparePredictions } from '../src/groundTruth/comparison';
import { CameraController } from '../src/camera/CameraController';
import { cameraOrientation,matrixIntrinsics } from '../src/camera/pose';
import { createChallengeCatalog } from '../src/challenges/catalog';
import { ThreeChallengeSceneProvider,disposeSceneGroup } from '../src/challenges/scene';
import type { CameraPhotoState } from '../src/camera/types';
function fixture(){const scene=new THREE.Scene(),registry=new TargetRegistry();for(const c of DEFAULT_TARGET_CLASSES)registry.registerClass(c);const service=new GroundTruthService(registry,scene),camera=new THREE.PerspectiveCamera(60,640/360,.1,100);camera.updateMatrixWorld(true);
  const mesh=new THREE.Mesh(new THREE.BoxGeometry(2,2,2),new THREE.MeshStandardMaterial());mesh.position.z=-10;scene.add(mesh);registry.registerTarget({object_id:'car-a',class_id:0,display_name:'Car A',mesh_reference:mesh},'test');
  return{scene,registry,service,camera,mesh,projection:()=>projectionCamera(camera,640,360),target:()=>registry.getTargets()[0],annotations:()=>service.generateFrameGroundTruth(projectionCamera(camera,640,360))};}
function photoState(f:ReturnType<typeof fixture>):CameraPhotoState{return{...f.projection(),simulation_time:12,metadata:{frame_id:3,timestamp:1000,image_width:640,image_height:360,image_source:'threejs-drone-camera',camera_pose:{position:{east:0,north:0,up:0},quaternion_scene:[0,0,0,1],rotation_optical_to_enu:[],pitch:0,yaw:0,mode:'body'},camera_intrinsics:{fx:300,fy:300,cx:320,cy:180,vertical_fov_degrees:60,projection:'pinhole'},drone_pose:{position:{east:0,north:0,up:0},heading:0,attitude:{pitch:0,roll:0}}},gimbal_pose:new CameraController().snapshot};}
it('manages unique object IDs and independent instances of a configurable class',()=>{
  const f=fixture(),other=f.mesh.clone();f.scene.add(other);assert.throws(()=>f.registry.registerTarget({object_id:'car-a',class_id:0,display_name:'dup',mesh_reference:other},'test'),/重複/);
  f.registry.registerTarget({object_id:'car-b',class_id:0,display_name:'B',mesh_reference:other},'test');assert.equal(f.registry.getTargets().filter(t=>t.class_name==='car').length,2);
  f.registry.registerClass({class_id:20,class_name:'solar_panel'});assert.throws(()=>f.registry.registerClass({class_id:20,class_name:'truck'}));f.registry.updateTarget('car-b',{class_id:20,annotation_enabled:false});assert.equal(f.registry.getTargets()[1].class_name,'solar_panel');
  f.registry.unregisterTarget('car-a');assert.equal(f.registry.getTargets().length,1);f.registry.clearScope('test');assert.equal(f.registry.getTargets().length,0);
});
it('transforms eight local corners through rotated/scaled parents and updates moving objects',()=>{
  const f=fixture(),parent=new THREE.Group();f.scene.add(parent);parent.add(f.mesh);parent.position.set(2,4,-3);parent.rotation.set(.2,.7,.1);parent.scale.set(2,.7,3);f.mesh.rotation.set(.3,.4,.5);
  const first=f.target(),worldPoints=boxCorners(f.mesh.geometry.boundingBox!).map(v=>v.applyMatrix4(f.mesh.matrixWorld));
  const bounds=new THREE.Box3().setFromPoints(first.bounding_box_3d.world_corners_scene.map(p=>new THREE.Vector3(...p)));for(const p of worldPoints)assert.ok(bounds.clone().expandByScalar(1e-9).containsPoint(p));assert.equal(first.bounding_box_3d.world_corners_enu.length,8);
  f.mesh.position.x+=3;const next=f.target();assert.notDeepEqual(first.world_position,next.world_position);assert.notDeepEqual(first.bounding_box_3d,next.bounding_box_3d);
  parent.scale.x=0;assert.throws(()=>f.target(),/非零/);
  const tiny=fixture();tiny.mesh.scale.setScalar(1e-7);assert.doesNotThrow(()=>tiny.target());
});
it('projects actual matrices, changes with distance/camera yaw and retains normalized bounds',()=>{
  const f=fixture(),a=projectTargetToCamera(f.target(),f.projection());assert.ok(a.in_frustum);assert.ok(Math.abs(a.projected_center!.x-320)<1e-8);assert.equal(a.in_frame_ratio,1);
  f.mesh.position.z=-20;const distant=projectTargetToCamera(f.target(),f.projection());assert.ok(distant.projected_area_ratio<a.projected_area_ratio*.3);
  f.camera.rotation.y=-.1;const rotated=projectTargetToCamera(f.target(),f.projection());assert.ok(rotated.projected_center!.x<320);
  f.camera.rotation.y=0;f.camera.projectionMatrix.elements[8]=.2;const offset=projectTargetToCamera(f.target(),f.projection());assert.ok(offset.projected_center!.x<300);
  assert.ok(offset.normalized_box!.x>=0&&offset.normalized_box!.x+offset.normalized_box!.width<=1);
  assert.equal(matrixIntrinsics(f.camera.projectionMatrix,640,360).cx,256);
});
it('uses gimbal pitch/yaw and parent camera transform without reconstructing FOV geometry',()=>{
  const f=fixture(),c=new CameraController();f.mesh.position.set(1,0,-3);f.camera.position.set(0,8,0);f.camera.fov=90;f.camera.updateProjectionMatrix();c.setMode('stabilized');c.setView('oblique');f.camera.quaternion.copy(cameraOrientation(new THREE.Quaternion(),c.snapshot,0));
  const oblique=projectTargetToCamera(f.target(),f.projection());assert.equal(oblique.in_frustum,true);c.setView('nadir');f.camera.quaternion.copy(cameraOrientation(new THREE.Quaternion(),c.snapshot,0));const nadir=projectTargetToCamera(f.target(),f.projection());assert.notEqual(nadir.projected_center!.y,oblique.projected_center!.y);
  c.setAngle('yaw',30);f.camera.quaternion.copy(cameraOrientation(new THREE.Quaternion(),c.snapshot,0));const yaw=projectTargetToCamera(f.target(),f.projection());assert.notDeepEqual(yaw.bounding_box_2d,nadir.bounding_box_2d);
  const parent=new THREE.Group();parent.position.x=2;parent.add(f.camera);assert.notDeepEqual(projectTargetToCamera(f.target(),f.projection()).bounding_box_2d,yaw.bounding_box_2d);
});
it('rejects behind/outside/far targets and clips partially out-of-frame geometry',()=>{
  const f=fixture();for(const p of [[0,0,5],[100,0,-10],[0,0,-120]]){f.mesh.position.set(...p as [number,number,number]);const a=f.annotations()[0];assert.equal(a.is_valid_annotation,false);assert.equal(a.bounding_box_2d,null);}
  f.mesh.position.set(5.7,0,-6);const a=f.annotations()[0];assert.ok(a.in_frame_ratio>0&&a.in_frame_ratio<1);assert.ok(a.is_partially_outside);assert.ok(a.bounding_box_2d!.x+a.bounding_box_2d!.width<=640);assert.equal(a.visibility_ratio,1);assert.equal(a.is_occluded,false);
});
it('clips near/far planes before perspective divide, including camera-inside-box cases',()=>{
  const f=fixture();f.mesh.position.set(0,0,-.2);f.mesh.scale.setScalar(.5);let p=projectTargetToCamera(f.target(),f.projection());assert.equal(p.in_frustum,true);assert.equal(p.depth_clipped,true);assert.ok(p.projected_area_ratio<=1.00000001);assert.ok(p.projected_points.every(v=>Number.isFinite(v.x)&&Number.isFinite(v.y)));
  f.mesh.position.z=0;f.mesh.scale.setScalar(5);p=projectTargetToCamera(f.target(),f.projection());assert.equal(p.in_frustum,true);assert.ok(p.projected_area_ratio>.99);
  f.mesh.scale.setScalar(.005);f.mesh.position.z=-.02;assert.equal(projectTargetToCamera(f.target(),f.projection()).in_frustum,false);
  f.mesh.scale.setScalar(2);f.mesh.position.z=-100;p=projectTargetToCamera(f.target(),f.projection());assert.equal(p.in_frustum,true);assert.equal(p.depth_clipped,true);
});
it('distinguishes full building occlusion, partial and mostly blocked targets',()=>{
  const f=fixture();assert.equal(f.annotations()[0].visibility_ratio,1);const wall=new THREE.Mesh(new THREE.BoxGeometry(4,4,.3),new THREE.MeshStandardMaterial());wall.position.z=-5;f.scene.add(wall);
  let a=f.annotations()[0];assert.equal(a.visibility_ratio,0);assert.equal(a.visibility_state,'occluded');assert.equal(a.is_valid_annotation,false);
  wall.scale.x=.25;wall.position.x=.5;a=f.annotations()[0];assert.ok(a.visibility_ratio>.25&&a.visibility_ratio<.75);assert.equal(a.is_occluded,true);assert.ok(a.visible_area_ratio<a.projected_area_ratio);
  wall.scale.x=.3;wall.position.x=.3;a=f.annotations()[0];assert.ok(a.visibility_ratio>0&&a.visibility_ratio<=.5);assert.equal(a.visibility_state,'mostly_occluded');
});
it('handles tree geometry, other targets, hidden parents and debug-only layers as occluders',()=>{
  const f=fixture(),tree=new THREE.Mesh(new THREE.ConeGeometry(.6,2,8),new THREE.MeshStandardMaterial());tree.position.z=-5;f.scene.add(tree);assert.ok(f.annotations()[0].visibility_ratio<1);
  tree.visible=false;assert.equal(f.annotations()[0].visibility_ratio,1);
  const front=f.mesh.clone();front.position.z=-5;front.scale.setScalar(2);f.scene.add(front);f.registry.registerTarget({object_id:'car-front',class_id:0,display_name:'front',mesh_reference:front,annotation_enabled:false},'test');assert.equal(f.annotations()[0].visibility_ratio,0);
  front.layers.set(30);assert.equal(f.annotations()[0].visibility_ratio,1);const parent=new THREE.Group();f.scene.add(parent);parent.add(front);front.layers.set(0);parent.visible=false;assert.equal(f.annotations()[0].visibility_ratio,1);
});
it('keeps visibility, frame fraction and visible image area distinct; rejects subpixel annotations',()=>{
  const f=fixture();f.mesh.position.set(5.7,0,-6);const clipped=f.annotations()[0];assert.equal(clipped.visibility_ratio,1);assert.ok(clipped.in_frame_ratio<1);assert.ok(clipped.visible_area_ratio<.5);
  f.mesh.position.set(0,0,-10);f.mesh.scale.setScalar(.001);const tiny=f.annotations()[0];assert.ok(Number.isFinite(tiny.visible_area_ratio));assert.equal(tiny.is_valid_annotation,false);
  f.registry.updateTarget('car-a',{visibility_enabled:false});assert.equal(f.annotations()[0].visibility_state,'disabled');f.registry.updateTarget('car-a',{annotation_enabled:false});assert.equal(f.annotations().length,0);
});
it('freezes truth before asynchronous encoding and keeps repeated queries and predictions isolated',()=>{
  const f=fixture(),prepared=f.service.preparePhoto('photo-a',photoState(f));f.mesh.position.x=10;f.camera.position.y=20;f.service.commitPhoto(prepared,new Blob(['pixels']));const stored=f.service.getPhotoSnapshot('photo-a')!;assert.equal(stored.simulation_time,12);assert.equal(stored.object_annotations[0].world_position.east,0);assert.equal(stored.camera_world_matrix[13],0);
  const query=f.service.getPhotoAnnotations('photo-a')!;query[0].world_position.east=99;assert.equal(f.service.getPhotoAnnotations('photo-a')![0].world_position.east,0);
  const matches=comparePredictions(stored,[{photo_id:'photo-a',model_id:'future-model',class_id:0,confidence:.9,bounding_box_2d:{...query[0].bounding_box_2d!}}]);assert.equal(matches[0].iou,1);assert.equal(matches[0].matched_object_id,'car-a');assert.ok(exportYolo(stored).startsWith('0 '));
  assert.throws(()=>comparePredictions(stored,[{photo_id:'wrong',model_id:'x',class_id:0,confidence:1,bounding_box_2d:{x:0,y:0,width:1,height:1}}]));
});
it('test scene contains two cars and all five configurable classes, and stale scope cleanup is safe',()=>{
  const f=fixture(),root=createGroundTruthTestScene();f.scene.add(root);const remove=f.service.activateScene('test-scene',root);assert.equal(f.registry.getTargets().length,6);assert.equal(f.registry.getTargets().filter(t=>t.class_name==='car').length,2);
  const replacement=createGroundTruthTestScene();f.scene.add(replacement);const removeNext=f.service.activateScene('test-scene',replacement);remove();assert.equal(f.registry.getTargets().length,6);removeNext();assert.equal(f.registry.getTargets().length,0);disposeSceneGroup(root);disposeSceneGroup(replacement);
});
it('challenge scene lifecycle clears targets and preserves shared objects',async()=>{
  const f=fixture();f.registry.clear();f.mesh.removeFromParent();const catalog=createChallengeCatalog(),base=new THREE.Group();f.scene.add(base);
  const provider=new ThreeChallengeSceneProvider(f.scene,base,catalog.scenes,{loaded:(d,group)=>{const mesh=new THREE.Mesh(new THREE.BoxGeometry(),new THREE.MeshStandardMaterial());mesh.userData.annotationTarget={object_id:'same-id',class_id:0,display_name:'level target'};group.add(mesh);return f.service.activateScene(d.id,group);}});
  const signal=new AbortController().signal,a=await provider.load(catalog.registry.get('waypoint-racing'),signal);assert.equal(f.registry.getTargets()[0].scope_id,'waypoint-racing');const b=await provider.load(catalog.registry.get('precision-landing'),signal);a.dispose();assert.equal(f.registry.getTargets().length,1);assert.equal(f.registry.getTargets()[0].scope_id,'precision-landing');b.dispose();assert.equal(f.registry.getTargets().length,0);assert.equal(base.visible,true);
});
