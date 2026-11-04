import * as THREE from 'three';
import type { Box3D,TargetClass,TargetRegistration,TargetState } from './types';
export const sceneToEnu=(v:THREE.Vector3)=>({east:v.x,north:-v.z,up:v.y});
export function boxCorners(box:THREE.Box3){return Array.from({length:8},(_,i)=>new THREE.Vector3(i&1?box.max.x:box.min.x,i&2?box.max.y:box.min.y,i&4?box.max.z:box.min.z));}
export function renderVisible(object:THREE.Object3D){for(let o:THREE.Object3D|null=object;o;o=o.parent)if(!o.visible)return false;return true;}
export function targetBounds(root:THREE.Object3D):Box3D {
  root.updateWorldMatrix(true,true);const inverse=root.matrixWorld.clone().invert(),local=new THREE.Box3();
  root.traverse(o=>{if(!(o instanceof THREE.Mesh))return;o.geometry.computeBoundingBox();if(!o.geometry.boundingBox)return;
    const transform=o===root?new THREE.Matrix4():inverse.clone().multiply(o.matrixWorld);for(const p of boxCorners(o.geometry.boundingBox))local.expandByPoint(p.applyMatrix4(transform));
  });
  const volumeScale=[0,1,2].reduce((product,column)=>product*new THREE.Vector3().setFromMatrixColumn(root.matrixWorld,column).length(),1);
  if(local.isEmpty()||![...local.min.toArray(),...local.max.toArray(),...root.matrixWorld.elements].every(Number.isFinite)||!Number.isFinite(root.matrixWorld.determinant())||volumeScale===0||Math.abs(root.matrixWorld.determinant())<1e-12*volumeScale)throw new Error('目標需要有效幾何與非零縮放');
  const corners=boxCorners(local).map(v=>v.applyMatrix4(root.matrixWorld)),world=new THREE.Box3().setFromPoints(corners);
  return{local_min:local.min.toArray(),local_max:local.max.toArray(),world_corners_scene:corners.map(p=>p.toArray()),world_corners_enu:corners.map(sceneToEnu),world_aabb:{min:{east:world.min.x,north:-world.max.z,up:world.min.y},max:{east:world.max.x,north:-world.min.z,up:world.max.y}}};
}
/** Internal registry: does not own meshes or expose itself through player APIs. */
export class TargetRegistry {
  constructor(readonly maxTargets=128){}
  private classes=new Map<number,TargetClass>();private entries=new Map<string,{registration:TargetRegistration;scope:string}>();
  registerClass(value:TargetClass){if(!Number.isInteger(value.class_id)||value.class_id<0||!value.class_name||this.classes.has(value.class_id)||[...this.classes.values()].some(c=>c.class_name===value.class_name))throw new Error('目標類別重複或不合法');this.classes.set(value.class_id,{...value});}
  getClasses(){return [...this.classes.values()].map(c=>({...c}));}
  registerTarget(value:TargetRegistration,scope_id:string){
    if(!value.object_id||this.entries.has(value.object_id))throw new Error('object_id 不得重複');if(this.entries.size>=this.maxTargets)throw new Error('目標數量超過限制');if(!this.classes.has(value.class_id))throw new Error('未註冊目標類別');targetBounds(value.mesh_reference);
    this.entries.set(value.object_id,{registration:{...value,metadata:structuredClone(value.metadata??{})},scope:scope_id});return()=>this.unregisterTarget(value.object_id);
  }
  unregisterTarget(id:string){this.entries.delete(id);}
  updateTarget(id:string,patch:Partial<Omit<TargetRegistration,'object_id'>>){const old=this.entries.get(id);if(!old)throw new Error('找不到目標');if(patch.class_id!==undefined&&!this.classes.has(patch.class_id))throw new Error('未註冊目標類別');const next={...old.registration,...patch};targetBounds(next.mesh_reference);next.metadata=structuredClone(next.metadata??{});this.entries.set(id,{registration:next,scope:old.scope});}
  clearScope(scope:string){for(const [id,e] of this.entries)if(e.scope===scope)this.entries.delete(id);}
  clear(){this.entries.clear();}
  getTargets(scope?:string):TargetState[]{return [...this.entries.values()].filter(e=>!scope||e.scope===scope).map(({registration:r,scope})=>{
    const box=targetBounds(r.mesh_reference),position=r.mesh_reference.getWorldPosition(new THREE.Vector3()),q=r.mesh_reference.getWorldQuaternion(new THREE.Quaternion());
    const axes=[new THREE.Vector3(1,0,0),new THREE.Vector3(0,1,0),new THREE.Vector3(0,0,1)].map(v=>sceneToEnu(v.applyQuaternion(q)));
    return{...this.classes.get(r.class_id)!,object_id:r.object_id,display_name:r.display_name,scope_id:scope,mesh_reference:r.mesh_reference,world_position:sceneToEnu(position),world_rotation:{quaternion_scene:q.toArray(),matrix_local_to_enu:[axes[0].east,axes[1].east,axes[2].east,axes[0].north,axes[1].north,axes[2].north,axes[0].up,axes[1].up,axes[2].up]},dimensions:{east:box.world_aabb.max.east-box.world_aabb.min.east,north:box.world_aabb.max.north-box.world_aabb.min.north,up:box.world_aabb.max.up-box.world_aabb.min.up},world_matrix_scene:r.mesh_reference.matrixWorld.toArray(),bounding_box_3d:box,visibility_enabled:r.visibility_enabled??true,annotation_enabled:r.annotation_enabled??true,render_visible:renderVisible(r.mesh_reference),metadata:structuredClone(r.metadata??{})};
  });}
  /** Factories opt in by tagging a root; scoped cleanup does not dispose shared geometry. */
  registerTree(root:THREE.Object3D,scope:string){const entries:Array<{id:string;object:THREE.Object3D}>=[];const remove=()=>{for(const {id,object} of entries){const e=this.entries.get(id);if(e?.scope===scope&&e.registration.mesh_reference===object)this.unregisterTarget(id);}};try{root.traverse(o=>{const tag=o.userData.annotationTarget as Omit<TargetRegistration,'mesh_reference'>|undefined;if(tag){this.registerTarget({...tag,mesh_reference:o},scope);entries.push({id:tag.object_id,object:o});}});}catch(error){remove();throw error;}return remove;}
}
