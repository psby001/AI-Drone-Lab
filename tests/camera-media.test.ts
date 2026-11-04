import { it } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import * as THREE from 'three';
import { CameraController } from '../src/camera/CameraController';
import { DroneCamera } from '../src/camera/DroneCamera';
it('frame provider throttles readbacks, exports metadata and Blob, and cleans bounded media resources',async()=>{
  const dom=new JSDOM('<body/>');
  const original={document:globalThis.document,HTMLCanvasElement:globalThis.HTMLCanvasElement,MediaRecorder:globalThis.MediaRecorder};
  let stopped=0,readbacks=0,renders=0,created=0;const revoked:string[]=[];
  class Recorder {
    static isTypeSupported(mime:string){return mime.startsWith('video/webm');}
    state='inactive';mimeType='video/webm';ondataavailable:((event:{data:Blob})=>void)|null=null;onstop:(()=>void)|null=null;onerror:(()=>void)|null=null;
    start(){this.state='recording';}
    stop(){this.state='inactive';queueMicrotask(()=>{this.ondataavailable?.({data:new Blob(['video'],{type:this.mimeType})});this.onstop?.();});}
  }
  Object.assign(globalThis,{document:dom.window.document,HTMLCanvasElement:dom.window.HTMLCanvasElement,MediaRecorder:Recorder});
  const create=URL.createObjectURL,revoke=URL.revokeObjectURL;URL.createObjectURL=()=>`blob:camera-${++created}`;URL.revokeObjectURL=url=>revoked.push(url);
  dom.window.HTMLCanvasElement.prototype.getContext=function(){return{createImageData:(w:number,h:number)=>({data:new Uint8ClampedArray(w*h*4)}),putImageData(){},drawImage(){}} as never;};
  dom.window.HTMLCanvasElement.prototype.toBlob=function(callback){callback(new Blob(['PNG'],{type:'image/png'}));};
  dom.window.HTMLCanvasElement.prototype.captureStream=function(){return{getTracks:()=>[{stop(){stopped++;}}]} as unknown as MediaStream;};
  const renderer={getContext:()=>({isContextLost:()=>false}),getRenderTarget:()=>null,getViewport:(v:THREE.Vector4)=>v,getScissor:(v:THREE.Vector4)=>v,getScissorTest:()=>false,setRenderTarget(){},setViewport(){},setScissor(){},setScissorTest(){},render(){renders++;},readRenderTargetPixels(_t:unknown,_x:number,_y:number,_w:number,_h:number,p:Uint8Array){readbacks++;p.fill(123);}} as unknown as THREE.WebGLRenderer;
  const controller=new CameraController(),scene=new THREE.Scene(),body=new THREE.Group();body.position.set(10,4,-6);body.scale.setScalar(.5);scene.add(body);
  const camera=new DroneCamera(controller,renderer,scene,body),pose={position:{east:10,north:6,up:4},heading:0,attitude:{pitch:0,roll:0}};
  try{
    camera.update(pose,performance.now());assert.equal(readbacks,0);
    controller.setEnabled(true);const now=performance.now();camera.update(pose,now);camera.update(pose,now+1);assert.equal(readbacks,1);camera.update(pose,now+100);assert.equal(readbacks,2);
    const frame=await camera.getFrame();assert.equal(frame.pixel_format,'blob');assert.ok(frame.pixels instanceof Blob);assert.equal(frame.image_width,1280);assert.equal(frame.image_height,720);
    assert.equal(frame.camera_pose.position.east,10);assert.ok(Math.abs(frame.camera_pose.position.north-6.34)<1e-9);assert.ok(Math.abs(frame.camera_pose.position.up-3.91)<1e-9);assert.equal(frame.drone_pose.heading,0);assert.equal(frame.image_source,'threejs-drone-camera');assert.ok(frame.timestamp>0);
    body.rotation.y=-Math.PI/2;pose.heading=90;camera.update(pose,now+200);const east=await camera.getFrame();
    assert.ok(Math.abs(east.camera_pose.position.east-10.34)<1e-9);assert.ok(Math.abs(east.camera_pose.rotation_optical_to_enu[2]-1)<1e-9);
    controller.setMode('stabilized');controller.setAngle('yaw',0);body.rotation.x=.3;pose.attitude.pitch=-THREE.MathUtils.radToDeg(.3);camera.update(pose,now+300);const stabilized=await camera.getFrame();
    assert.ok(Math.abs(stabilized.camera_pose.rotation_optical_to_enu[2]-1)<1e-9);assert.ok(Math.abs(stabilized.camera_pose.rotation_optical_to_enu[8])<1e-9);
    controller.setEnabled(false);let delivered=0;const unsubscribe=camera.subscribe(()=>{delivered++;void camera.getFrame().catch(()=>{});});camera.update(pose,now+400);assert.equal(delivered,1);unsubscribe();const reads=readbacks;camera.update(pose,now+500);assert.equal(readbacks,reads);
    for(let i=0;i<10;i++)await camera.capturePhoto();assert.equal(camera.getSnapshot().assets.length,8);assert.equal(revoked.length,2);
    camera.startRecording();assert.equal(camera.getSnapshot().recording,true);await camera.stopRecording();assert.equal(stopped,1);assert.equal(camera.getSnapshot().assets.at(-1)!.kind,'video');
    const signal=new AbortController().signal;await camera.execute({action:'start_recording'},signal);await camera.stopRecording();await camera.execute({action:'stop_recording'},signal);assert.equal(stopped,2);
    camera.startRecording();camera.dispose();await Promise.resolve();assert.equal(stopped,3);assert.equal(body.children.length,0);assert.ok(revoked.length>=10);assert.equal(renders,readbacks);
    await assert.rejects(camera.getFrame(),/相機已關閉/);
    Object.assign(globalThis,{MediaRecorder:undefined});const unsupported=new DroneCamera(controller,renderer,scene,body);
    try{assert.equal(unsupported.getSnapshot().recordingSupported,false);assert.throws(()=>unsupported.startRecording(),/不支援/);unsupported.update(pose,performance.now());await unsupported.capturePhoto();assert.equal(unsupported.getSnapshot().assets.length,1);}finally{unsupported.dispose();}
  }finally{camera.dispose();URL.createObjectURL=create;URL.revokeObjectURL=revoke;Object.assign(globalThis,original);dom.window.close();}
});
