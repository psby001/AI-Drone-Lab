import * as THREE from 'three';
import type { Point2,ProjectionCamera,ProjectionResult,TargetState } from './types';
export function projectionCamera(camera:THREE.PerspectiveCamera,width:number,height:number):ProjectionCamera {camera.updateWorldMatrix(true,false);return{camera_world_matrix:camera.matrixWorld.toArray(),camera_projection_matrix:camera.projectionMatrix.toArray(),image_width:width,image_height:height,near:camera.near,far:camera.far,layers_mask:camera.layers.mask};}
export function frozenCamera(s:ProjectionCamera){const c=new THREE.PerspectiveCamera();c.matrixAutoUpdate=false;c.matrixWorld.fromArray(s.camera_world_matrix);c.matrixWorldInverse.copy(c.matrixWorld).invert();c.projectionMatrix.fromArray(s.camera_projection_matrix);c.projectionMatrixInverse.copy(c.projectionMatrix).invert();c.near=s.near;c.far=s.far;c.layers.mask=s.layers_mask;return c;}
type V=THREE.Vector4;
function clip4(poly:V[],plane:(p:V)=>number){const output:V[]=[];for(let i=0;i<poly.length;i++){const a=poly[i],b=poly[(i+1)%poly.length],da=plane(a),db=plane(b),insideA=da>=0,insideB=db>=0;if(insideA)output.push(a);if(insideA!==insideB)output.push(a.clone().lerp(b,da/(da-db)));}return output;}
function cross(a:Point2,b:Point2,c:Point2){return(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);}
function hull(points:Point2[]){const p=points.filter(v=>Number.isFinite(v.x)&&Number.isFinite(v.y)).sort((a,b)=>a.x-b.x||a.y-b.y),lower:Point2[]=[],upper:Point2[]=[];for(const v of p){while(lower.length>=2&&cross(lower.at(-2)!,lower.at(-1)!,v)<=0)lower.pop();lower.push(v);}for(const v of [...p].reverse()){while(upper.length>=2&&cross(upper.at(-2)!,upper.at(-1)!,v)<=0)upper.pop();upper.push(v);}return [...lower.slice(0,-1),...upper.slice(0,-1)];}
export function polygonArea(points:Point2[]){return Math.abs(points.reduce((a,p,i)=>{const q=points[(i+1)%points.length];return a+p.x*q.y-q.x*p.y;},0))/2;}
function clip2(poly:Point2[],distance:(p:Point2)=>number){const output:Point2[]=[];for(let i=0;i<poly.length;i++){const a=poly[i],b=poly[(i+1)%poly.length],da=distance(a),db=distance(b);if(da>=0)output.push(a);if((da>=0)!==(db>=0)){const t=da/(da-db);output.push({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t});}}return output;}
/** Clip all box faces in homogeneous space BEFORE perspective division; then clip silhouette to the viewport. */
export function projectTargetToCamera(target:Pick<TargetState,'object_id'|'bounding_box_3d'>,s:ProjectionCamera):ProjectionResult {
  if(!Number.isInteger(s.image_width)||!Number.isInteger(s.image_height)||s.image_width<=0||s.image_height<=0||s.near<=0||s.far<=s.near||s.camera_world_matrix.length!==16||s.camera_projection_matrix.length!==16||![...s.camera_world_matrix,...s.camera_projection_matrix,s.near,s.far].every(Number.isFinite)||target.bounding_box_3d.world_corners_scene.length!==8)throw new Error('相機矩陣、尺寸或八角點資料不合法');
  const c=frozenCamera(s),matrix=c.projectionMatrix.clone().multiply(c.matrixWorldInverse),corners=target.bounding_box_3d.world_corners_scene.map(p=>new THREE.Vector4(...p,1).applyMatrix4(matrix));
  const faces=[[0,1,3,2],[4,6,7,5],[0,4,5,1],[2,3,7,6],[0,2,6,4],[1,5,7,3]],vertices:V[]=[];
  for(const face of faces){let poly=face.map(i=>corners[i]);poly=clip4(poly,p=>p.z+p.w);poly=clip4(poly,p=>p.w-p.z);vertices.push(...poly);}
  const w=s.image_width,h=s.image_height,full=hull(vertices.filter(p=>p.w>1e-12).map(p=>({x:(p.x/p.w+1)*w/2,y:(1-p.y/p.w)*h/2}))),fullArea=polygonArea(full);
  let clipped=full;for(const distance of [(p:Point2)=>p.x,(p:Point2)=>w-p.x,(p:Point2)=>p.y,(p:Point2)=>h-p.y])clipped=clip2(clipped,distance);
  const area=polygonArea(clipped),valid=fullArea>1e-10&&area>1e-10;
  const x=valid?Math.max(0,Math.min(...clipped.map(p=>p.x))):0,y=valid?Math.max(0,Math.min(...clipped.map(p=>p.y))):0,right=valid?Math.min(w,Math.max(...clipped.map(p=>p.x))):0,bottom=valid?Math.min(h,Math.max(...clipped.map(p=>p.y))):0;
  const ratio=valid?Math.min(1,area/fullArea):0,box=valid?{x,y,width:right-x,height:bottom-y}:null;
  return{object_id:target.object_id,projected_points:valid?clipped:[],bounding_box_2d:box,normalized_box:box?{x:box.x/w,y:box.y/h,width:box.width/w,height:box.height/h}:null,projected_center:box?{x:box.x+box.width/2,y:box.y+box.height/2}:null,normalized_center:box?{x:(box.x+box.width/2)/w,y:(box.y+box.height/2)/h}:null,projected_area_ratio:Math.max(0,Math.min(1,area/(w*h))),bounding_box_area_ratio:box?box.width*box.height/(w*h):0,in_frustum:valid,in_frame_ratio:ratio,clipped_fraction:1-ratio,depth_clipped:corners.some(p=>p.z+p.w<0||p.w-p.z<0)};
}
