import * as THREE from 'three';
import type { TargetClass } from './types';
/** Catalog is data, not a switch inside registry/projection/visibility. */
export const DEFAULT_TARGET_CLASSES:TargetClass[]=[{class_id:0,class_name:'car'},{class_id:1,class_name:'person'},{class_id:2,class_name:'building'},{class_id:3,class_name:'container'},{class_id:4,class_name:'tent'}];
function box(parent:THREE.Object3D,size:[number,number,number],position:[number,number,number],color:number){const mesh=new THREE.Mesh(new THREE.BoxGeometry(...size),new THREE.MeshStandardMaterial({color,roughness:.85}));mesh.position.set(...position);parent.add(mesh);return mesh;}
function target(root:THREE.Group,id:string,class_id:number,name:string,east:number,north:number){const g=new THREE.Group();g.position.set(east,0,-north);g.userData.annotationTarget={object_id:id,class_id,display_name:name,metadata:{test_scene:true}};root.add(g);return g;}
export function createGroundTruthTestScene(){
  const root=new THREE.Group();root.name='ground-truth-test';box(root,[90,.1,90],[0,-.1,0],0xaebca5);
  for(const [id,e,n,color] of [['car-a',-2,7,0xc35f44],['car-b',3,10,0x3e81ab]] as const){const g=target(root,id,0,id,e,n);box(g,[1.6,.55,3.2],[0,.6,0],color);box(g,[1.3,.55,1.5],[0,1.1,-.1],0x6d8c96);for(const x of [-.8,.8])for(const z of [-1,1])box(g,[.18,.5,.5],[x,.35,z],0x253238);}
  const person=target(root,'person-a',1,'人物',1,6);box(person,[.45,.9,.3],[0,1,0],0xe5b94d);box(person,[.35,.35,.35],[0,1.65,0],0xc49c7f);for(const x of [-.14,.14])box(person,[.18,.6,.23],[x,.3,0],0x334e64);
  const building=target(root,'building-a',2,'建築物',-5,14);box(building,[4,6,4],[0,3,0],0xb0a695);
  const container=target(root,'container-a',3,'貨櫃',5,15);box(container,[2.4,2.5,5],[0,1.25,0],0x527e84);
  const tent=target(root,'tent-a',4,'帳篷',0,16);const roof=new THREE.Mesh(new THREE.ConeGeometry(2,2.5,4),new THREE.MeshStandardMaterial({color:0xc3a15d,flatShading:true}));roof.position.y=1.25;roof.rotation.y=Math.PI/4;tent.add(roof);
  // A solid wall and a low-poly tree are occluders even without annotation tags.
  box(root,[2.4,2.5,.5],[3,1.25,-8.2],0x7e8991);
  box(root,[.3,2,.3],[-1,1,-11],0x756a53);const leaves=new THREE.Mesh(new THREE.ConeGeometry(1.4,3,7),new THREE.MeshStandardMaterial({color:0x507553}));leaves.position.set(-1,3,-11);root.add(leaves);
  return root;
}
