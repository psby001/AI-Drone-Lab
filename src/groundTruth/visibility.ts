import * as THREE from 'three';
import { renderVisible } from './TargetRegistry';
import { frozenCamera } from './projection';
import type { ProjectionCamera,ProjectionResult,TargetState,VisibilityEstimate } from './types';
const base=(state:VisibilityEstimate['visibility_state']):VisibilityEstimate=>({visibility_ratio:0,visible_area_ratio:0,visibility_state:state,sample_count:0,target_sample_count:0,visible_sample_count:0,sample_method:'stratified-screen-rays'});
function materialAt(hit:THREE.Intersection){const object=hit.object as THREE.Mesh;return Array.isArray(object.material)?object.material[hit.face?.materialIndex??0]:object.material;}
export function collectOccluders(scene:THREE.Object3D,layers:number){const meshes:THREE.Mesh[]=[];scene.traverse(o=>{if(o instanceof THREE.Mesh&&renderVisible(o)&&(o.layers.mask&layers)!==0){const materials=Array.isArray(o.material)?o.material:[o.material];if(materials.some(m=>m.visible&&m.depthWrite&&m.opacity>=.5))meshes.push(o);}});return meshes;}
/** Conditional visibility among projected target surface samples INSIDE the image.
 * in_frame_ratio remains a separate bounding-silhouette estimate from projection. */
export function estimateVisibility(target:TargetState,projection:ProjectionResult,s:ProjectionCamera,occluders:THREE.Mesh[],samples=144):VisibilityEstimate {
  if(!target.visibility_enabled||!target.render_visible)return base('disabled');if(!projection.in_frustum||!projection.bounding_box_2d)return base('out_of_frame');
  const box=projection.bounding_box_2d,camera=frozenCamera(s),targetMeshes:THREE.Mesh[]=[];
  target.mesh_reference.traverse(o=>{if(o instanceof THREE.Mesh&&renderVisible(o)&&(o.layers.mask&s.layers_mask)!==0)targetMeshes.push(o);});
  const ray=new THREE.Raycaster(),point=new THREE.Vector2();let targetHits=0,visible=0;
  const columns=Math.max(1,Math.min(32,Math.round(Math.sqrt(samples*box.width/Math.max(.000001,box.height))))),rows=Math.max(1,Math.min(32,Math.floor(samples/columns))),count=columns*rows;
  const validDepth=(hit:THREE.Intersection)=>{const depth=-hit.point.clone().applyMatrix4(camera.matrixWorldInverse).z;return depth>=s.near-1e-8&&depth<=s.far+1e-8;};
  ray.layers.mask=s.layers_mask;
  for(let y=0;y<rows;y++)for(let x=0;x<columns;x++){
    point.set((box.x+(x+.5)/columns*box.width)/s.image_width*2-1,1-(box.y+(y+.5)/rows*box.height)/s.image_height*2);ray.setFromCamera(point,camera);
    const own=ray.intersectObjects(targetMeshes,false).find(h=>validDepth(h)&&materialAt(h)?.visible&&materialAt(h).opacity>0);if(!own)continue;targetHits++;
    const first=ray.intersectObjects(occluders,false).find(h=>validDepth(h)&&materialAt(h)?.visible&&materialAt(h).depthWrite&&materialAt(h).opacity>=.5);
    if(!first||first.distance>=own.distance-1e-5)visible++;
  }
  if(!targetHits)return{...base('unsampled'),sample_count:count};
  const ratio=visible/targetHits;
  return{visibility_ratio:ratio,visible_area_ratio:Math.min(projection.projected_area_ratio,projection.bounding_box_area_ratio*visible/count),visibility_state:ratio>=.98?'unoccluded':ratio>.5?'partial':ratio>0?'mostly_occluded':'occluded',sample_count:count,target_sample_count:targetHits,visible_sample_count:visible,sample_method:'stratified-screen-rays'};
}
