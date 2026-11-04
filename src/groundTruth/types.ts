import type * as THREE from 'three';
import type { Vec3 } from '../core/coordinates';
import type { CameraFrameMetadata,CameraPhotoState } from '../camera/types';
export type Point2={x:number;y:number};
export interface BoundingBox2D {x:number;y:number;width:number;height:number}
export interface TargetClass {class_id:number;class_name:string}
export interface TargetRegistration {
  object_id:string;class_id:number;display_name:string;mesh_reference:THREE.Object3D;
  visibility_enabled?:boolean;annotation_enabled?:boolean;metadata?:Record<string,unknown>;
}
export interface Box3D {
  local_min:[number,number,number];local_max:[number,number,number];
  world_corners_scene:Array<[number,number,number]>;world_corners_enu:Vec3[];
  world_aabb:{min:Vec3;max:Vec3};
}
export interface TargetState extends TargetClass {
  object_id:string;display_name:string;scope_id:string;mesh_reference:THREE.Object3D;
  world_position:Vec3;world_rotation:{quaternion_scene:[number,number,number,number];matrix_local_to_enu:number[]};dimensions:Vec3;
  world_matrix_scene:number[];
  bounding_box_3d:Box3D;visibility_enabled:boolean;annotation_enabled:boolean;render_visible:boolean;metadata:Record<string,unknown>;
}
export interface ProjectionCamera {
  camera_world_matrix:number[];camera_projection_matrix:number[];image_width:number;image_height:number;near:number;far:number;layers_mask:number;
}
export interface ProjectionResult {
  object_id:string;projected_points:Point2[];bounding_box_2d:BoundingBox2D|null;normalized_box:BoundingBox2D|null;
  projected_center:Point2|null;normalized_center:Point2|null;projected_area_ratio:number;bounding_box_area_ratio:number;
  in_frustum:boolean;in_frame_ratio:number;clipped_fraction:number;depth_clipped:boolean;
}
export type VisibilityState='unoccluded'|'partial'|'mostly_occluded'|'occluded'|'out_of_frame'|'unsampled'|'disabled';
export interface VisibilityEstimate {
  visibility_ratio:number;visible_area_ratio:number;visibility_state:VisibilityState;
  sample_count:number;target_sample_count:number;visible_sample_count:number;sample_method:'stratified-screen-rays';
}
export interface ObjectAnnotation extends ProjectionResult,VisibilityEstimate,TargetClass {
  world_position:Vec3;world_rotation:TargetState['world_rotation'];bounding_box_3d:Box3D;
  world_matrix_scene:number[];
  is_in_frame:boolean;is_occluded:boolean;is_partially_outside:boolean;is_valid_annotation:boolean;
}
export interface CameraSnapshot extends ProjectionCamera {
  photo_id:string;frame_id:number;timestamp:number;simulation_time:number;image_data:Blob;image_source:'threejs-drone-camera';
  camera_intrinsics:CameraFrameMetadata['camera_intrinsics'];drone_pose:CameraFrameMetadata['drone_pose'];gimbal_pose:CameraPhotoState['gimbal_pose'];
  scene_id:string;object_annotations:ObjectAnnotation[];
}
/** Predictions have no authority to mutate stored Ground Truth. */
export interface ObjectPrediction {class_id:number;confidence:number;bounding_box_2d:BoundingBox2D;model_id:string;photo_id:string}
export type PreparedSnapshot=Omit<CameraSnapshot,'image_data'>;
