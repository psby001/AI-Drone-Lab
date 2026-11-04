import * as THREE from 'three';
import { toScene } from '../core/coordinates';
import type { FlightState } from '../core/flight';
import { PluginRegistry } from './registry';
import type { ChallengeDefinition,ChallengeEvent,ChallengeSceneHandle,ChallengeSceneProvider,SceneObject } from './types';
export interface SceneFactory {schema:object;validateDefinition?(definition:ChallengeDefinition):void;create(definition:ChallengeDefinition):THREE.Group;load?(definition:ChallengeDefinition,signal:AbortSignal):Promise<THREE.Group>;colliders?(definition:ChallengeDefinition):SceneObject[];update?(group:THREE.Group,snapshot:import('./types').ChallengeSnapshot):void}
export function seededRandom(seed:number){return()=>{seed=(seed+0x6D2B79F5)|0;let t=Math.imul(seed^(seed>>>15),1|seed);t^=t+Math.imul(t^(t>>>7),61|t);return((t^(t>>>14))>>>0)/4294967296;};}
function addMesh(group:THREE.Group,geometry:THREE.BufferGeometry,color:string,position:[number,number,number],transparent=false){const mesh=new THREE.Mesh(geometry,new THREE.MeshStandardMaterial({color,roughness:.9,transparent,opacity:transparent?.22:1,depthWrite:!transparent}));mesh.position.set(...position);group.add(mesh);return mesh;}
export function buildScene(d:ChallengeDefinition,garden:boolean){
  const group=new THREE.Group();group.name=`challenge:${d.id}`;
  addMesh(group,new THREE.BoxGeometry(220,.2,220),String(d.scene.params.ground),[0,-.15,0]);
  const grid=new THREE.GridHelper(100,50,0x708c86,0xaabcb2);grid.position.y=.005;group.add(grid);
  for(const o of d.scene.objects){const p=toScene(o.position);
    if(o.kind==='platform'){addMesh(group,new THREE.CylinderGeometry(o.size.east/2,o.size.east/2,.08,32),o.color,[p[0],p[1]+.04,p[2]]);}
    else if(['waypoint','zone','target'].includes(o.kind)){
      addMesh(group,new THREE.SphereGeometry(o.size.east/2,16,10),o.color,p,true);
      const ring=addMesh(group,new THREE.TorusGeometry(o.size.east/2,.035,6,40),o.color,p);ring.rotation.x=Math.PI/2;
    }else addMesh(group,new THREE.BoxGeometry(o.size.east,o.size.up,o.size.north),o.color,p);
  }
  const random=seededRandom(d.scene.seed),count=garden?24:8;
  for(let i=0;i<count;i++){const a=random()*Math.PI*2,r=52+random()*18;addMesh(group,new THREE.ConeGeometry(.8+random(),2+random()*3,5),garden?'#4e8875':'#829c8f',[Math.cos(a)*r,1,Math.sin(a)*r]);}
  return group;
}
export function createSceneRegistry(){const schema={type:'object',additionalProperties:false,required:['ground','sky'],properties:{ground:{type:'string',pattern:'^#[0-9a-fA-F]{6}$'},sky:{type:'string',pattern:'^#[0-9a-fA-F]{6}$'}}};return new PluginRegistry<SceneFactory>().register('training-ground',{schema,create:d=>buildScene(d,false)}).register('marker-garden',{schema,create:d=>buildScene(d,true)});}
export function disposeSceneGroup(group:THREE.Group){const geometries=new Set<THREE.BufferGeometry>(),materials=new Set<THREE.Material>(),textures=new Set<THREE.Texture>();group.traverse(o=>{if(o instanceof THREE.InstancedMesh)o.dispose();if(o instanceof THREE.Mesh||o instanceof THREE.Line||o instanceof THREE.LineSegments||o instanceof THREE.Sprite){if(!(o instanceof THREE.Sprite))geometries.add(o.geometry);for(const m of Array.isArray(o.material)?o.material:[o.material]){materials.add(m);for(const value of Object.values(m))if(value instanceof THREE.Texture)textures.add(value);}}});group.removeFromParent();geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());textures.forEach(t=>t.dispose());group.clear();}
/** Swept sphere/AABB detection prevents tunneling; emits on contact entry, not every frame. */
export function collisionSampler(objects:SceneObject[]){let contacts=new Set<string>();return(current:FlightState,previous:FlightState|null):ChallengeEvent[]=>{
  const next=new Set<string>(),events:ChallengeEvent[]=[];
  for(const o of objects.filter(o=>o.solid)){
    const start=previous?.position??current.position,end=current.position;let near=0,far=1;
    for(const axis of ['east','north','up'] as const){const low=o.position[axis]-o.size[axis]/2-.45,high=o.position[axis]+o.size[axis]/2+.45,delta=end[axis]-start[axis];if(Math.abs(delta)<1e-12){if(start[axis]<low||start[axis]>high){near=2;break;}}else{const a=(low-start[axis])/delta,b=(high-start[axis])/delta;near=Math.max(near,Math.min(a,b));far=Math.min(far,Math.max(a,b));}}
    const inside=(['east','north','up'] as const).every(axis=>Math.abs(end[axis]-o.position[axis])<=o.size[axis]/2+.45);
    if(inside)next.add(o.id);if(near<=far&&far>=0&&near<=1&&!contacts.has(o.id))events.push({type:'collision',id:o.id});
  }contacts=next;return events;
};}
/** Owns only challenge objects and backdrop. Drone, lights and both cameras are shared. */
export class ThreeChallengeSceneProvider implements ChallengeSceneProvider {
  private active:ChallengeSceneHandle|null=null;
  private generation=0;
  constructor(private scene:THREE.Scene,private base:THREE.Group,private factories:PluginRegistry<SceneFactory>,private lifecycle?:{loaded(definition:ChallengeDefinition,group:THREE.Group):()=>void},private container:THREE.Object3D=scene){}
  async load(d:ChallengeDefinition,signal:AbortSignal):Promise<ChallengeSceneHandle>{
    if(signal.aborted)throw new Error('場景載入已取消');const generation=++this.generation;this.active?.dispose();
    const factory=this.factories.get(d.scene.type),group=factory.load?await factory.load(d,signal):factory.create(d),background=this.scene.background,fog=this.scene.fog;
    if(signal.aborted||generation!==this.generation){disposeSceneGroup(group);throw new Error('場景載入已取消');}
    this.base.visible=false;
    if(typeof d.scene.params.sky==='string'){this.scene.background=new THREE.Color(d.scene.params.sky);this.scene.fog=new THREE.Fog(d.scene.params.sky,48,115);}
    this.container.add(group);
    let cleanup=()=>{};
    let disposed=false;const handle:ChallengeSceneHandle={sample:collisionSampler([...d.scene.objects,...(factory.colliders?.(d)??[])]),update:s=>{if(!disposed)factory.update?.(group,s);},dispose:()=>{if(disposed)return;disposed=true;cleanup();disposeSceneGroup(group);this.base.visible=true;this.scene.background=background;this.scene.fog=fog;if(this.active===handle)this.active=null;}};
    try{cleanup=this.lifecycle?.loaded(d,group)??cleanup;}catch(error){handle.dispose();throw error;}
    this.active=handle;return handle;
  }
  dispose(){this.generation++;this.active?.dispose();}
}
