import type * as THREE from 'three';
import type { CameraPhotoState } from '../camera/types';
import { TargetRegistry } from './TargetRegistry';
import { projectTargetToCamera } from './projection';
import { collectOccluders,estimateVisibility } from './visibility';
import type { CameraSnapshot,ObjectAnnotation,PreparedSnapshot,ProjectionCamera } from './types';
/** Internal capability; never attached to window, CameraFrameProvider or AI endpoints. */
export class GroundTruthService {
  private photos=new Map<string,CameraSnapshot>();private activeScene='free-flight';private generation=0;
  constructor(readonly registry:TargetRegistry,private scene:THREE.Scene){}
  activateScene(id:string,root:THREE.Object3D){this.registry.clear();this.activeScene=id;const generation=++this.generation;let remove:()=>void;try{remove=this.registry.registerTree(root,id);}catch(error){this.activeScene='free-flight';throw error;}return()=>{if(this.generation!==generation)return;remove();this.registry.clear();this.activeScene='free-flight';};}
  get sceneId(){return this.activeScene;}
  generateFrameGroundTruth(camera:ProjectionCamera):ObjectAnnotation[]{
    this.scene.updateMatrixWorld(true);const targets=this.registry.getTargets().filter(t=>t.annotation_enabled);if(!targets.length)return[];
    const occluders=collectOccluders(this.scene,camera.layers_mask),samples=Math.max(16,Math.min(144,Math.floor(4096/targets.length)));
    return targets.map(t=>{
      const projection=projectTargetToCamera(t,camera),visibility=estimateVisibility(t,projection,camera,occluders,samples);
      return{...projection,...visibility,object_id:t.object_id,class_id:t.class_id,class_name:t.class_name,world_position:t.world_position,world_matrix_scene:t.world_matrix_scene,world_rotation:t.world_rotation,bounding_box_3d:t.bounding_box_3d,is_in_frame:projection.in_frustum,is_partially_outside:projection.in_frame_ratio>0&&projection.in_frame_ratio<.999,is_occluded:visibility.target_sample_count>0&&visibility.visibility_ratio<.98,is_valid_annotation:t.visibility_enabled&&t.render_visible&&projection.in_frustum&&visibility.visibility_ratio>=.1&&visibility.visible_area_ratio*camera.image_width*camera.image_height>=1};
    });
  }
  preparePhoto(photoId:string,state:CameraPhotoState):PreparedSnapshot {
    const metadata=state.metadata,camera:ProjectionCamera={camera_world_matrix:[...state.camera_world_matrix],camera_projection_matrix:[...state.camera_projection_matrix],image_width:metadata.image_width,image_height:metadata.image_height,near:state.near,far:state.far,layers_mask:state.layers_mask};
    return structuredClone({...camera,photo_id:photoId,frame_id:metadata.frame_id,timestamp:metadata.timestamp,simulation_time:state.simulation_time,image_source:metadata.image_source,camera_intrinsics:metadata.camera_intrinsics,drone_pose:metadata.drone_pose,gimbal_pose:state.gimbal_pose,scene_id:this.activeScene,object_annotations:this.generateFrameGroundTruth(camera)});
  }
  commitPhoto(prepared:PreparedSnapshot,image:Blob){this.photos.set(prepared.photo_id,{...structuredClone(prepared),image_data:image});while(this.photos.size>8)this.photos.delete(this.photos.keys().next().value!);}
  getPhotoAnnotations(id:string){const value=this.photos.get(id);return value?structuredClone(value.object_annotations):null;}
  getPhotoSnapshot(id:string){const value=this.photos.get(id);return value?structuredClone(value):null;}
  removePhoto(id:string){this.photos.delete(id);}
  dispose(){this.photos.clear();this.registry.clear();}
}
export function exportYolo(snapshot:Pick<CameraSnapshot,'object_annotations'>){return snapshot.object_annotations.filter(a=>a.is_valid_annotation&&a.normalized_box).map(a=>{const b=a.normalized_box!;return`${a.class_id} ${(b.x+b.width/2).toFixed(6)} ${(b.y+b.height/2).toFixed(6)} ${b.width.toFixed(6)} ${b.height.toFixed(6)}`;}).join('\n');}
export function snapshotJson(snapshot:CameraSnapshot){const {image_data,...data}=snapshot;return JSON.stringify({...data,image_reference:`${snapshot.photo_id}.png`},null,2);}
