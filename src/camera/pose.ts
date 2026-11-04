import * as THREE from 'three';
import type { CameraSettings } from './types';
const rad=THREE.MathUtils.degToRad;
/** Camera optical forward=-Z, image up=+Y. Pitch<0 looks down; yaw>0 turns right.
 * Body: Qworld=Qbody*Qmount*Ry(-yaw)*Rx(pitch).
 * Stabilized: Qworld=Ry(-heading)*Qmount*Ry(-yaw)*Rx(pitch), rejects body tilt.
 * Both modes use yaw relative to the nose; stabilized mode follows heading.
 * Translation ALWAYS follows the rigid body mount. */
export function cameraOrientation(body:THREE.Quaternion,s:CameraSettings,heading?:number){
  const mount=new THREE.Quaternion().setFromEuler(new THREE.Euler(rad(s.mount.pitch),-rad(s.mount.yaw),-rad(s.mount.roll),'YXZ'));
  const yawRotation=heading===undefined?new THREE.Euler().setFromQuaternion(body,'YXZ').y:-rad(heading);
  return (s.mode==='body'?body.clone():new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),yawRotation)).multiply(mount)
    .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),-rad(s.yaw)))
    .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0),rad(s.pitch)));
}
export function intrinsics(width:number,height:number,fov:number){const f=height/(2*Math.tan(rad(fov)/2));return{fx:f,fy:f,cx:width/2,cy:height/2,vertical_fov_degrees:fov,projection:'pinhole' as const};}
/** Read actual projection parameters, including principal-point offsets and camera zoom. */
export function matrixIntrinsics(matrix:THREE.Matrix4,width:number,height:number){const e=matrix.elements,fx=e[0]*width/2,fy=e[5]*height/2,cx=(1-e[8])*width/2,cy=(1+e[9])*height/2;return{fx,fy,cx,cy,vertical_fov_degrees:THREE.MathUtils.radToDeg(Math.atan(cy/fy)+Math.atan((height-cy)/fy)),projection:'pinhole' as const};}
export function opticalToEnu(q:THREE.Quaternion){
  const axes=[new THREE.Vector3(1,0,0),new THREE.Vector3(0,-1,0),new THREE.Vector3(0,0,-1)].map(v=>v.applyQuaternion(q));
  return[axes[0].x,axes[1].x,axes[2].x,-axes[0].z,-axes[1].z,-axes[2].z,axes[0].y,axes[1].y,axes[2].y];
}
