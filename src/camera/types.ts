export const CAMERA_LIMITS = {minPitch:-90,maxPitch:30,minYaw:-180,maxYaw:180,minFov:25,maxFov:110,maxFps:30,maxRecordingSeconds:120,maxRecordingBytes:64*1024*1024,maxAssetBytes:64*1024*1024,maxAssets:8} as const;
export const CAMERA_RESOLUTIONS = {'1280×720':[1280,720],'640×360':[640,360],'320×180':[320,180],'1920×1080':[1920,1080]} as const;
export type CameraView='fpv'|'nadir'|'oblique'|'custom';
export type GimbalMode='body'|'stabilized';
export type CameraCommand =
  | {action:'set_camera_view';view:CameraView;mode?:GimbalMode}
  | {action:'set_gimbal_pitch';angle:number}
  | {action:'set_gimbal_yaw';angle:number}
  | {action:'reset_gimbal'|'capture_photo'|'start_recording'|'stop_recording'};
export const CAMERA_ACTIONS=new Set(['set_camera_view','set_gimbal_pitch','set_gimbal_yaw','reset_gimbal','capture_photo','start_recording','stop_recording']);
export function isCameraCommand(command:{action:string}):command is CameraCommand{return CAMERA_ACTIONS.has(command.action);}
export interface CameraSettings {
  view:CameraView;pitch:number;yaw:number;mode:GimbalMode;fov:number;width:number;height:number;fps:number;enabled:boolean;
  mount:{right:number;forward:number;up:number;pitch:number;yaw:number;roll:number};
}
export interface DronePose {position:{east:number;north:number;up:number};heading:number;attitude:{pitch:number;roll:number}}
export interface CameraFrameMetadata {
  frame_id:number;timestamp:number;image_width:number;image_height:number;image_source:'threejs-drone-camera';
  camera_pose:{position:{east:number;north:number;up:number};quaternion_scene:[number,number,number,number];rotation_optical_to_enu:number[];pitch:number;yaw:number;mode:GimbalMode};
  drone_pose:DronePose;
  camera_intrinsics:{fx:number;fy:number;cx:number;cy:number;vertical_fov_degrees:number;projection:'pinhole'};
}
/** Internal, immutable-at-capture camera state; not included in the player frame API. */
export interface CameraPhotoState {
  metadata:CameraFrameMetadata;simulation_time:number;camera_world_matrix:number[];camera_projection_matrix:number[];
  near:number;far:number;layers_mask:number;gimbal_pose:Pick<CameraSettings,'pitch'|'yaw'|'mode'|'mount'>;
}
export interface CameraPhotoObserver {
  prepare(photoId:string,state:CameraPhotoState):unknown;
  commit(photoId:string,prepared:unknown,image:Blob):void;
  remove(photoId:string):void;
}
export type CameraFrame=CameraFrameMetadata&({pixels:Blob;pixel_format:'blob'}|{pixels:ImageBitmap;pixel_format:'bitmap'});
/** Consumers own/close returned ImageBitmaps. Metadata subscriptions never encode pixels. */
export interface CameraFrameProvider {
  getFrame(format?:'blob'|'bitmap'):Promise<CameraFrame>;
  subscribe(listener:(metadata:CameraFrameMetadata)=>void):()=>void;
}
export interface MissionCameraPort {execute(command:CameraCommand,signal:AbortSignal):void|Promise<void>;cancel():void}
