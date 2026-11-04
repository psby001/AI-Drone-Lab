import * as THREE from 'three';
import { CameraController } from './CameraController';
import { cameraOrientation,matrixIntrinsics,opticalToEnu } from './pose';
import { CAMERA_LIMITS as L,type CameraFrame,type CameraFrameMetadata,type CameraFrameProvider,type DronePose,type CameraCommand,type MissionCameraPort,type CameraPhotoObserver,type CameraPhotoState } from './types';
export interface CameraAsset {id:number;name:string;url:string;kind:'photo'|'video';bytes:number;photo_id?:string}
export interface CameraMediaState {recording:boolean;stopping:boolean;assets:CameraAsset[];message:string;recordingSupported:boolean}
/** One shared WebGL renderer/scene, one bounded render target and reusable readback buffer.
 * GPU readback occurs only at camera FPS while preview/recording/subscribers need it,
 * or on explicit frame/photo requests. No base64 and no per-render pixel allocation. */
export class DroneCamera implements CameraFrameProvider,MissionCameraPort {
  readonly canvas=document.createElement('canvas');
  readonly camera=new THREE.PerspectiveCamera(70,16/9,0.025,180);
  private mount=new THREE.Group();
  private visual=new THREE.Mesh(new THREE.BoxGeometry(0.075,0.055,0.07),new THREE.MeshStandardMaterial({color:0x182e37,roughness:0.6}));
  private context:CanvasRenderingContext2D;
  private target:THREE.WebGLRenderTarget|null=null;
  private pixels=new Uint8Array(0);
  private image:ImageData|null=null;
  private lastDraw=-Infinity;
  private lastSettings:unknown=null;
  private latest:CameraFrameMetadata|null=null;
  private pose:DronePose|null=null;
  private frameId=0;
  private assetId=0;
  private disposed=false;
  private frameListeners=new Set<(metadata:CameraFrameMetadata)=>void>();
  private listeners=new Set<()=>void>();
  private recorder:MediaRecorder|null=null;
  private stream:MediaStream|null=null;
  private chunks:Blob[]=[];
  private bytes=0;
  private timer:ReturnType<typeof setTimeout>|undefined;
  private stopPromise:Promise<void>|null=null;
  private resolveStop:(()=>void)|null=null;
  private rejectStop:((reason:Error)=>void)|null=null;
  private taskOwnsRecording=false;
  private completedTaskRecording=false;
  private takingPhoto=false;
  private simulationTime=0;
  private photoObserver:CameraPhotoObserver|null=null;
  private value:CameraMediaState={recording:false,stopping:false,assets:[],message:'相機就緒',recordingSupported:typeof MediaRecorder!=='undefined'&&typeof HTMLCanvasElement.prototype.captureStream==='function'};
  constructor(readonly controller:CameraController,private renderer:THREE.WebGLRenderer,private scene:THREE.Scene,private body:THREE.Object3D){
    const context=this.canvas.getContext('2d',{alpha:false});if(!context)throw new Error('瀏覽器不支援相機 Canvas');this.context=context;
    this.canvas.setAttribute('aria-label','無人機即時相機畫面');this.canvas.style.width='100%';this.canvas.style.display='block';
    this.mount.name='drone-payload-camera-mount';this.body.add(this.mount);this.mount.add(this.camera,this.visual);
    this.visual.layers.set(1); // Visible in the observer view, excluded from its own payload camera.
  }
  getSnapshot=()=>this.value;
  getMetadata(){return this.latest?structuredClone(this.latest):null;}
  subscribeStatus=(listener:()=>void)=>{this.listeners.add(listener);return()=>{this.listeners.delete(listener);};};
  private status(patch:Partial<CameraMediaState>){this.value={...this.value,...patch};for(const listener of this.listeners)listener();}
  subscribe(listener:(metadata:CameraFrameMetadata)=>void){this.frameListeners.add(listener);return()=>{this.frameListeners.delete(listener);};}
  setPhotoObserver(observer:CameraPhotoObserver|null){this.photoObserver=observer;}
  update(pose:DronePose,now:number,simulationTime=now/1000){
    if(this.disposed)return;this.pose=structuredClone(pose);this.simulationTime=simulationTime;this.updateTransform();
    if((this.controller.snapshot.enabled||this.value.recording||this.frameListeners.size>0)&&now-this.lastDraw>=1000/this.controller.snapshot.fps){
      try{this.draw(now);}catch(error){this.status({message:error instanceof Error?error.message:'相機影像更新失敗'});}
    }
  }
  private updateTransform(){
    const s=this.controller.snapshot,scale=this.body.getWorldScale(new THREE.Vector3()),bodyQ=this.body.getWorldQuaternion(new THREE.Quaternion());
    this.mount.position.set(s.mount.right/scale.x,s.mount.up/scale.y,-s.mount.forward/scale.z);
    const local=bodyQ.clone().invert().multiply(cameraOrientation(bodyQ,s,this.pose?.heading));
    this.camera.quaternion.copy(local);this.camera.scale.set(1/scale.x,1/scale.y,1/scale.z);
    this.visual.quaternion.copy(local);this.visual.scale.set(1/scale.x,1/scale.y,1/scale.z);
    this.camera.fov=s.fov;this.camera.aspect=s.width/s.height;this.camera.updateProjectionMatrix();this.camera.updateWorldMatrix(true,false);
  }
  private draw(now=performance.now(),capture?:(state:CameraPhotoState)=>void){
    if(this.disposed||!this.pose)throw new Error('相機尚未取得場景狀態');
    if(this.renderer.getContext().isContextLost())throw new Error('相機 WebGL 已中斷');
    this.updateTransform();const s=this.controller.snapshot;
    if(!this.target||this.canvas.width!==s.width||this.canvas.height!==s.height){
      this.target?.dispose();this.target=new THREE.WebGLRenderTarget(s.width,s.height,{depthBuffer:true});this.target.texture.colorSpace=THREE.SRGBColorSpace;
      this.canvas.width=s.width;this.canvas.height=s.height;this.pixels=new Uint8Array(s.width*s.height*4);this.image=this.context.createImageData(s.width,s.height);
    }
    const target=this.renderer.getRenderTarget();
    try{
      // RenderTarget viewport is physical pixels. renderer.setViewport() multiplies by DPR,
      // which would crop/zoom the sensor image and invalidate all camera projections.
      this.target.viewport.set(0,0,s.width,s.height);this.target.scissorTest=false;this.renderer.setRenderTarget(this.target);
      this.renderer.render(this.scene,this.camera);this.renderer.readRenderTargetPixels(this.target,0,0,s.width,s.height,this.pixels);
    }finally{this.renderer.setRenderTarget(target);}
    const row=s.width*4;
    for(let y=0;y<s.height;y++)this.image!.data.set(this.pixels.subarray((s.height-1-y)*row,(s.height-y)*row),y*row);
    this.context.putImageData(this.image!,0,0);this.lastDraw=now;
    this.lastSettings=s;
    const position=this.camera.getWorldPosition(new THREE.Vector3()),q=this.camera.getWorldQuaternion(new THREE.Quaternion());
    this.latest={frame_id:++this.frameId,timestamp:Date.now(),image_width:s.width,image_height:s.height,image_source:'threejs-drone-camera',
      camera_pose:{position:{east:position.x,north:-position.z,up:position.y},quaternion_scene:[q.x,q.y,q.z,q.w],rotation_optical_to_enu:opticalToEnu(q),pitch:s.pitch,yaw:s.yaw,mode:s.mode},
      drone_pose:structuredClone(this.pose),camera_intrinsics:matrixIntrinsics(this.camera.projectionMatrix,s.width,s.height)};
    // Runs synchronously against the just-rendered geometry, before subscribers can mutate it.
    capture?.({metadata:structuredClone(this.latest),simulation_time:this.simulationTime,camera_world_matrix:this.camera.matrixWorld.toArray(),camera_projection_matrix:this.camera.projectionMatrix.toArray(),near:this.camera.near,far:this.camera.far,layers_mask:this.camera.layers.mask,gimbal_pose:structuredClone({pitch:s.pitch,yaw:s.yaw,mode:s.mode,mount:s.mount})});
    for(const listener of this.frameListeners){try{listener(structuredClone(this.latest));}catch{/* A consumer cannot break flight or other consumers. */}}
  }
  async getFrame(format:'blob'|'bitmap'='blob'):Promise<CameraFrame>{
    if(this.disposed)throw new Error('相機已關閉');
    if(!this.latest||this.lastSettings!==this.controller.snapshot||performance.now()-this.lastDraw>=1000/this.controller.snapshot.fps)this.draw();const metadata=structuredClone(this.latest!);
    if(format==='bitmap'){
      if(typeof createImageBitmap!=='function')throw new Error('瀏覽器不支援 ImageBitmap，請使用 Blob');
      const pixels=await createImageBitmap(this.freezeCanvas());if(this.disposed){pixels.close();throw new Error('相機已關閉');}return{...metadata,pixels,pixel_format:'bitmap'};
    }
    const pixels=await this.encodeCanvas(this.freezeCanvas());
    if(this.disposed)throw new Error('相機已關閉');return{...metadata,pixels,pixel_format:'blob'};
  }
  private freezeCanvas(){const canvas=document.createElement('canvas');canvas.width=this.canvas.width;canvas.height=this.canvas.height;const context=canvas.getContext('2d');if(!context)throw new Error('無法固定相機影像');context.drawImage(this.canvas,0,0);return canvas;}
  private encodeCanvas(canvas:HTMLCanvasElement){return new Promise<Blob>((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(new Error('影像編碼失敗')),'image/png'));}
  private releaseAsset(asset:CameraAsset){URL.revokeObjectURL(asset.url);if(asset.photo_id)this.photoObserver?.remove(asset.photo_id);}
  private addAsset(blob:Blob,kind:CameraAsset['kind'],photo_id?:string){
    if(this.disposed)return;const id=++this.assetId,extension=kind==='photo'?'png':blob.type.includes('mp4')?'mp4':'webm';
    const asset={id,name:`drone-${kind}-${Date.now()}-${id}.${extension}`,url:URL.createObjectURL(blob),kind,bytes:blob.size,...(photo_id?{photo_id}:{})},assets=[...this.value.assets,asset];
    while(assets.length>L.maxAssets||assets.reduce((total,asset)=>total+asset.bytes,0)>L.maxAssetBytes)this.releaseAsset(assets.shift()!);
    this.status({assets,message:kind==='photo'?'照片已拍攝，請從下方下載':'影片已完成，請從下方下載'});
    return assets.includes(asset)?asset:null;
  }
  async capturePhoto(signal?:AbortSignal){
    if(this.takingPhoto)throw new Error('照片處理中，請稍候');if(this.disposed)throw new Error('相機已關閉');this.takingPhoto=true;
    try{
      // Task captures invoked during the physics tick run after the scene commits its transforms.
      await Promise.resolve();if(signal?.aborted)throw new Error('相機指令已取消');
      const photoId=`photo-${Array.from(crypto.getRandomValues(new Uint32Array(4)),n=>n.toString(16).padStart(8,'0')).join('')}`,observer=this.photoObserver;
      let prepared:unknown,frozen:HTMLCanvasElement|null=null,annotationFailed=false;
      this.draw(performance.now(),state=>{frozen=this.freezeCanvas();try{prepared=observer?.prepare(photoId,state);}catch{annotationFailed=true;}});
      const image=await this.encodeCanvas(frozen!);if(this.disposed)throw new Error('相機已關閉');if(signal?.aborted)throw new Error('相機指令已取消');
      const asset=this.addAsset(image,'photo',photoId);if(asset&&prepared!==undefined){try{observer?.commit(photoId,prepared,image);}catch{annotationFailed=true;}}
      if(annotationFailed)this.status({message:'照片已保留，但內部標註失敗'});return photoId;
    }finally{this.takingPhoto=false;}
  }
  deleteAsset(id:number){const asset=this.value.assets.find(a=>a.id===id);if(asset)this.releaseAsset(asset);this.status({assets:this.value.assets.filter(a=>a.id!==id)});}
  startRecording(){
    if(!this.value.recordingSupported)throw new Error('此瀏覽器不支援 Canvas 錄影，可改用拍照');
    if(this.value.recording||this.value.stopping)throw new Error('錄影已啟動或仍在輸出');
    this.draw();this.stream=this.canvas.captureStream(this.controller.snapshot.fps);
    try{
      const mime=['video/webm;codecs=vp9','video/webm;codecs=vp8','video/mp4','video/webm'].find(type=>MediaRecorder.isTypeSupported(type));
      this.recorder=new MediaRecorder(this.stream,{...(mime?{mimeType:mime}:{}),videoBitsPerSecond:2500000});
      this.chunks=[];this.bytes=0;
      this.stopPromise=new Promise<void>((resolve,reject)=>{this.resolveStop=resolve;this.rejectStop=reject;});
      void this.stopPromise.catch(()=>{});
      this.recorder.ondataavailable=event=>{
        if(event.data.size){this.bytes+=event.data.size;if(this.bytes<=L.maxRecordingBytes)this.chunks.push(event.data);else{this.status({message:'影片超過 64MiB，已停止並捨棄不完整檔案'});void this.stopRecording().catch(()=>{});}}
      };
      this.recorder.onerror=()=>{this.status({message:'瀏覽器錄影失敗'});this.finishRecording(new Error('瀏覽器錄影失敗'));};
      this.recorder.onstop=()=>{if(this.bytes>L.maxRecordingBytes)this.finishRecording(new Error('影片超過大小上限'));else{const blob=new Blob(this.chunks,{type:this.recorder?.mimeType||mime||'video/webm'});if(blob.size)this.addAsset(blob,'video');this.finishRecording();}};
      this.recorder.start(1000);this.status({recording:true,stopping:false,message:'錄影中（最長 120 秒，無麥克風音訊）'});
      this.completedTaskRecording=false;
      this.timer=setTimeout(()=>{void this.stopRecording().catch(()=>{});},L.maxRecordingSeconds*1000);
    }catch(error){if(this.stopPromise)this.finishRecording(error instanceof Error?error:new Error('錄影啟動失敗'));else this.releaseStream();throw error;}
  }
  stopRecording():Promise<void>{
    if(this.value.stopping)return this.stopPromise??Promise.resolve();
    if(!this.recorder||!this.value.recording)return Promise.reject(new Error('目前沒有錄影'));
    this.status({recording:false,stopping:true});clearTimeout(this.timer);
    const promise=this.stopPromise!;if(this.recorder.state!=='inactive')this.recorder.stop();else this.finishRecording();return promise;
  }
  private releaseStream(){this.stream?.getTracks().forEach(track=>track.stop());this.stream=null;clearTimeout(this.timer);}
  private finishRecording(error?:Error){
    this.releaseStream();this.recorder=null;this.chunks=[];if(this.taskOwnsRecording&&!error)this.completedTaskRecording=true;this.taskOwnsRecording=false;
    this.status({recording:false,stopping:false});if(error)this.rejectStop?.(error);else this.resolveStop?.();this.resolveStop=null;this.rejectStop=null;this.stopPromise=null;
  }
  async execute(command:CameraCommand,signal:AbortSignal){
    if(signal.aborted)throw new Error('相機指令已取消');
    switch(command.action){
      case 'set_camera_view':if(command.mode)this.controller.setMode(command.mode);this.controller.setView(command.view);break;
      case 'set_gimbal_pitch':this.controller.setAngle('pitch',command.angle);break;
      case 'set_gimbal_yaw':this.controller.setAngle('yaw',command.angle);break;
      case 'reset_gimbal':this.controller.reset();break;
      case 'capture_photo':await this.capturePhoto(signal);break;
      case 'start_recording':this.startRecording();this.taskOwnsRecording=true;break;
      case 'stop_recording':if(!this.value.recording&&!this.value.stopping&&this.completedTaskRecording){this.completedTaskRecording=false;break;}await this.stopRecording();this.completedTaskRecording=false;break;
    }
  }
  cancel(){if(this.taskOwnsRecording&&this.value.recording)void this.stopRecording().catch(()=>{});}
  dispose(){
    if(this.disposed)return;
    this.disposed=true;this.cancel();if(this.value.recording)void this.stopRecording().catch(()=>{});this.releaseStream();
    this.target?.dispose();this.target=null;this.mount.removeFromParent();this.visual.geometry.dispose();(this.visual.material as THREE.Material).dispose();
    this.value.assets.forEach(a=>this.releaseAsset(a));this.photoObserver=null;this.frameListeners.clear();this.listeners.clear();this.canvas.remove();this.pixels=new Uint8Array(0);this.image=null;this.pose=null;
  }
}
