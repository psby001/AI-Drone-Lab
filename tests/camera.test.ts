import { MISSION_LIMITS as Budget } from '../src/config/limits';
import { it } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CameraController } from '../src/camera/CameraController';
import { cameraOrientation,intrinsics,opticalToEnu } from '../src/camera/pose';
import { validateMission } from '../src/missions/validate';
import { MissionRunner } from '../src/missions/MissionRunner';
import { FlightModel } from '../src/core/flight';
import { CAMERA_PRESETS } from '../src/camera/presets';
import { generatePython } from '../src/dronekit/generate';
import type { MissionCommand } from '../src/missions/types';
import type { CameraCommand } from '../src/camera/types';
import { validateAiOutput } from '../server/service';
import { ready } from './fixtures/ai';
const wrap=(commands:MissionCommand[])=>({version:'1.2',commands:[{action:'takeoff',altitude:3},...commands,{action:'land'}]});
it('presets and stabilized orientation follow heading while rejecting pitch and roll',()=>{
  const c=new CameraController(),forward=new THREE.Vector3(0,0,-1);
  const body=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),-Math.PI/2);
  assert.ok(forward.clone().applyQuaternion(cameraOrientation(body,c.snapshot)).distanceTo(new THREE.Vector3(1,0,0))<1e-10);
  c.setView('nadir');assert.ok(forward.clone().applyQuaternion(cameraOrientation(body,c.snapshot)).distanceTo(new THREE.Vector3(0,-1,0))<1e-10);
  c.setView('oblique');const oblique=forward.clone().applyQuaternion(cameraOrientation(new THREE.Quaternion(),c.snapshot));assert.ok(oblique.y<-.7&&oblique.z<-.7);
  c.setMode('stabilized');const stable=cameraOrientation(body,c.snapshot,90);
  const tilted=body.clone().multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(.3,0,.4)));
  assert.ok(stable.angleTo(cameraOrientation(tilted,c.snapshot,90))<1e-7);
  assert.ok(stable.angleTo(cameraOrientation(tilted,c.snapshot,180))>1.5);
  const matrix=opticalToEnu(cameraOrientation(new THREE.Quaternion(),new CameraController().snapshot));assert.deepEqual(matrix.map(n=>n===0?0:n),[1,0,0,0,0,1,0,-1,0]);
  for(const [axis,angle] of [['pitch',31],['pitch',-91],['yaw',181],['yaw',NaN]] as const)assert.throws(()=>c.setAngle(axis,angle));
  assert.throws(()=>c.setFov(120));assert.throws(()=>c.setMount({...c.snapshot.mount,forward:1}));
  const k=intrinsics(1280,720,90);assert.ok(Math.abs(k.fx-360)<1e-10);assert.equal(k.cx,640);assert.equal(k.cy,360);
});
it('relative gimbal yaw survives mode changes and resets; heading wrap remains continuous',()=>{
  const c=new CameraController(),forward=new THREE.Vector3(0,0,-1),identity=new THREE.Quaternion();
  c.setAngle('yaw',30);c.setMode('stabilized');assert.equal(c.snapshot.yaw,30);
  const look=forward.clone().applyQuaternion(cameraOrientation(identity,c.snapshot,90));
  assert.ok(look.distanceTo(new THREE.Vector3(Math.sqrt(3)/2,0,.5))<1e-10);
  const a=cameraOrientation(identity,c.snapshot,359),b=cameraOrientation(identity,c.snapshot,1);
  assert.ok(Math.abs(a.angleTo(b)-THREE.MathUtils.degToRad(2))<1e-10);
  c.setMode('body');assert.equal(c.snapshot.yaw,30);c.setMode('stabilized');c.reset();assert.equal(c.snapshot.yaw,0);
  for(const heading of [0,90,180,270]){
    c.setView('nadir');assert.ok(forward.clone().applyQuaternion(cameraOrientation(identity,c.snapshot,heading)).distanceTo(new THREE.Vector3(0,-1,0))<1e-10);
    c.setView('fpv');const q=cameraOrientation(identity,c.snapshot,heading);
    assert.ok(q.angleTo(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),-THREE.MathUtils.degToRad(heading)))<1e-7);
  }
});
it('camera commands are validated within the original finite mission budget, including recording lifecycle',async()=>{
  for(const preset of CAMERA_PRESETS)assert.deepEqual(validateMission(preset.mission).errors,[]);
  for(const preset of CAMERA_PRESETS)assert.deepEqual(validateAiOutput(ready(preset.mission)).mission!.commands,preset.mission.commands);
  assert.ok(validateMission({version:'1.2',commands:[{action:'capture_photo'},{action:'takeoff',altitude:3},{action:'land'},{action:'capture_photo'}]}).plan);
  for(const commands of [
    [{action:'set_gimbal_pitch',angle:31}],[{action:'set_gimbal_yaw',angle:-181}],[{action:'set_camera_view',view:'fake'}],
    [{action:'stop_recording'}],[{action:'start_recording'}],[{action:'start_recording'},{action:'start_recording'},{action:'stop_recording'}],
    [{action:'parallel',commands:[{action:'move_forward',distance:1},{action:'capture_photo'}]}],
    [{action:'repeat',count:4,commands:Array(Math.floor((Budget.maxCommands-2)/4)+1).fill({action:'capture_photo'})}],
  ])assert.ok(validateMission(wrap(commands as MissionCommand[])).errors.length,JSON.stringify(commands));
  assert.ok(validateMission({...CAMERA_PRESETS[0].mission,version:'1.1'}).errors.length);
  await assert.rejects(generatePython(CAMERA_PRESETS[0].mission),/尚未提供對應/);
});
it('camera tasks execute once in order through the existing physics, then land and can run again',async()=>{
  const runner=new MissionRunner(new FlightModel()),calls:CameraCommand[]=[];
  runner.setCameraPort({execute(command){calls.push(command);},cancel(){}});
  assert.deepEqual(runner.load(CAMERA_PRESETS[0].mission),[]);
  for(let run=0;run<2;run++){
    assert.equal(runner.start(),true);
    for(let i=0;i<120*120&&runner.ownsControl;i++){runner.update(1/120);if(i%10===0)await Promise.resolve();}
    assert.equal(runner.snapshot.status,'completed',runner.snapshot.message);assert.equal(runner.model.state.mode,'grounded');
  }
  assert.equal(calls.filter(c=>c.action==='capture_photo').length,4);
  assert.deepEqual(calls.slice(0,3).map(c=>c.action),['set_camera_view','capture_photo','set_camera_view']);
});
it('pause freezes camera-step advancement and stop aborts pending work without late completion',async()=>{
  const runner=new MissionRunner(new FlightModel());let resolve:()=>void=()=>{};let signal:AbortSignal|undefined,cancelled=0;
  runner.setCameraPort({execute(_command,s){signal=s;return new Promise<void>(r=>{resolve=r;});},cancel(){cancelled++;}});
  runner.load({version:'1.2',commands:[{action:'capture_photo'},{action:'takeoff',altitude:3},{action:'land'}]});runner.start();runner.update(1/60);
  runner.pause();resolve();await Promise.resolve();runner.update(.1);assert.equal(runner.snapshot.index,0);
  runner.resume();runner.update(1/60);assert.equal(runner.snapshot.index,1);
  runner.stop();runner.reset();runner.start();runner.update(1/60);runner.stop();assert.ok(signal?.aborted);resolve();await Promise.resolve();runner.update(.1);assert.equal(runner.snapshot.status,'stopped');assert.equal(runner.snapshot.index,0);assert.ok(cancelled>0);
  const unsupported=new MissionRunner(new FlightModel());unsupported.load(CAMERA_PRESETS[0].mission);unsupported.start();
  for(let i=0;i<120*30&&unsupported.ownsControl;i++)unsupported.update(1/120);
  assert.equal(unsupported.snapshot.status,'failed');assert.match(unsupported.snapshot.message,/相機模組不可用/);
});
