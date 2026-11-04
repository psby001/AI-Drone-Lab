import { CAMERA_LIMITS as L,CAMERA_RESOLUTIONS,type CameraSettings,type CameraView,type GimbalMode } from './types';
export class CameraController {
  private listeners=new Set<()=>void>();
  private value:CameraSettings={view:'fpv',pitch:0,yaw:0,mode:'body',fov:70,width:1280,height:720,fps:15,enabled:false,mount:{right:0,forward:0.34,up:-0.09,pitch:0,yaw:0,roll:0}};
  get snapshot(){return this.value;}
  subscribe=(listener:()=>void)=>{this.listeners.add(listener);return()=>{this.listeners.delete(listener);};};
  private change(patch:Partial<CameraSettings>){this.value={...this.value,...patch};for(const listener of this.listeners)listener();}
  setEnabled(enabled:boolean){this.change({enabled});}
  setView(view:CameraView){if(!['fpv','nadir','oblique','custom'].includes(view))throw new Error('不支援的相機視角');this.change({view,...(view==='custom'?{}:{pitch:view==='nadir'?-90:view==='oblique'?-45:0,yaw:0})});}
  setAngle(axis:'pitch'|'yaw',angle:number){const min=axis==='pitch'?L.minPitch:L.minYaw,max=axis==='pitch'?L.maxPitch:L.maxYaw;if(!Number.isFinite(angle)||angle<min||angle>max)throw new Error(`雲台 ${axis} 須介於 ${min}–${max}°`);this.change({[axis]:angle,view:'custom'});}
  setMode(mode:GimbalMode){if(!['body','stabilized'].includes(mode))throw new Error('不支援的雲台模式');if(mode===this.value.mode)return;this.change({mode});}
  reset(){this.setView('fpv');}
  setFov(fov:number){if(!Number.isFinite(fov)||fov<L.minFov||fov>L.maxFov)throw new Error('FOV 須介於 25–110°');this.change({fov});}
  setResolution(width:number,height:number){if(!Object.values(CAMERA_RESOLUTIONS).some(([w,h])=>w===width&&h===height))throw new Error('不支援的解析度');this.change({width,height});}
  setFps(fps:number){if(!Number.isInteger(fps)||fps<1||fps>L.maxFps)throw new Error('相機 FPS 須介於 1–30');this.change({fps});}
  lowQuality(){this.change({width:640,height:360,fps:10});}
  setMount(mount:CameraSettings['mount']){if(!Object.values(mount).every(Number.isFinite)||Math.max(Math.abs(mount.right),Math.abs(mount.forward),Math.abs(mount.up))>0.5||Math.max(Math.abs(mount.pitch),Math.abs(mount.yaw),Math.abs(mount.roll))>180)throw new Error('安裝偏移須在 ±0.5m，外參角須在 ±180°');this.change({mount:{...mount}});}
}
