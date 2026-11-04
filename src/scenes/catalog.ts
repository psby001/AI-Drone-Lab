import * as THREE from 'three';
import { FreeSceneRegistry,type FreeSceneDefinition } from './FreeFlightScenes';
import type { SceneFactory } from '../challenges/scene';
import { seededRandom } from '../challenges/scene';
import { photoHuntScene } from '../challenges/photoHunt/scene';
import { PHOTO_HUNT } from '../challenges/photoHunt/definition';
import type { ChallengeDefinition,SceneObject } from '../challenges/types';

function box(root:THREE.Group,x:number,n:number,w:number,h:number,depth:number,color:string,up=h/2){const m=new THREE.Mesh(new THREE.BoxGeometry(w,h,depth),new THREE.MeshStandardMaterial({color,flatShading:true}));m.position.set(x,up,-n);root.add(m);return m;}
function ring(root:THREE.Group,x:number,n:number,r:number,color:string){const m=new THREE.Mesh(new THREE.TorusGeometry(r,.035,4,64),new THREE.MeshBasicMaterial({color}));m.rotation.x=-Math.PI/2;m.position.set(x,.1,-n);root.add(m);}
function markerLabel(root:THREE.Group,text:string,x:number,n:number){
  if(typeof document==='undefined')return;
  const canvas=document.createElement('canvas');canvas.width=128;canvas.height=64;const ctx=canvas.getContext('2d');if(!ctx)return;
  ctx.fillStyle='#f7f5dd';ctx.fillRect(0,0,128,64);ctx.fillStyle='#294a54';ctx.font='bold 38px sans-serif';ctx.textAlign='center';ctx.fillText(text,64,46);
  const sprite=new THREE.Sprite(new THREE.SpriteMaterial({map:new THREE.CanvasTexture(canvas),depthTest:true}));sprite.position.set(x,1.7,-n);sprite.scale.set(1.3,.65,1);root.add(sprite);
}
function tree(root:THREE.Group,x:number,n:number,i:number,id:string){const g=new THREE.Group();g.position.set(x,0,-n);g.userData.annotationTarget={object_id:`${id}:tree:${i}`,class_id:5,display_name:'樹木'};root.add(g);box(g,0,0,.3,1.8,.3,'#826547');const crown=new THREE.Mesh(new THREE.ConeGeometry(1.4,3.6,5),new THREE.MeshStandardMaterial({color:i%2?'#386650':'#638652',flatShading:true}));crown.position.y=3;g.add(crown);}
function foundation(d:ChallengeDefinition){const root=new THREE.Group();root.name=`free:${d.id}`;box(root,0,0,180,.2,180,String(d.scene.params.ground),-.12);const grid=new THREE.GridHelper(100,50,'#829e86','#b0c3a4');grid.position.y=.005;root.add(grid);
  const p=d.spawn.position;const pad=new THREE.Mesh(new THREE.CylinderGeometry(1,1,.08,32),new THREE.MeshStandardMaterial({color:'#284b50'}));pad.position.set(p.east,.04,-p.north);root.add(pad);ring(root,p.east,p.north,.85,'#f1cf70');box(root,p.east-.3,p.north,.08,.02,1,'#ffffff',.1);box(root,p.east+.3,p.north,.08,.02,1,'#ffffff',.1);box(root,p.east,p.north,.6,.02,.08,'#ffffff',.1);
  const radius=Number(d.scene.params.radius),height=Number(d.scene.params.height);ring(root,0,0,radius,'#e7b34b');const cyl=new THREE.CylinderGeometry(radius,radius,height,64,1,true);const edge=new THREE.LineSegments(new THREE.EdgesGeometry(cyl),new THREE.LineBasicMaterial({color:'#d9b865',transparent:true,opacity:.22}));cyl.dispose();edge.position.y=height/2;root.add(edge);return root;}
const obstacle=(id:string,e:number,n:number,w:number,h:number,depth:number):SceneObject=>({id,kind:'obstacle',position:{east:e,north:n,up:h/2},size:{east:w,north:depth,up:h},color:'#777777',solid:true});
function smallScene(d:ChallengeDefinition){const root=foundation(d),random=seededRandom(d.scene.seed);
  if(d.id==='forest'){
    // Raised terrain is scenery with conservative colliders; the launch clearing remains level.
    for(let i=0;i<4;i++){const hill=new THREE.Mesh(new THREE.ConeGeometry(6,4+i%2,7),new THREE.MeshStandardMaterial({color:i%2?'#839760':'#99ad78',flatShading:true}));hill.position.set(-17+i*11,1.8,-23);root.add(hill);}
    const lake=new THREE.Mesh(new THREE.CircleGeometry(7,24),new THREE.MeshStandardMaterial({color:'#459eac',roughness:.35}));lake.rotation.x=-Math.PI/2;lake.scale.x=1.8;lake.position.set(-18,.04,4);root.add(lake);
    box(root,0,8,3,.03,25,'#ccb68a',.035);
    for(let i=0;i<35;i++){const a=random()*Math.PI*2,r=16+random()*18;tree(root,Math.cos(a)*r,Math.sin(a)*r,i,d.id);}
    const tent=new THREE.Mesh(new THREE.ConeGeometry(2.2,2.5,4),new THREE.MeshStandardMaterial({color:'#edc34f',flatShading:true}));tent.position.set(9,1.25,-10);tent.userData.annotationTarget={object_id:'forest:tent',class_id:4,display_name:'觀景帳篷'};root.add(tent);
  }else if(d.id==='exam'){
    box(root,0,8,80,.02,20,'#607b86',.02);box(root,0,6,26,.02,14,'#6c7271',.04);
    for(const x of [-6,6])for(const r of [4,6,8])ring(root,x,6,r,r===6?'#53c9eb':'#a9ed5a');
    for(const [i,[x,n]] of [[-6,12],[-12,6],[-6,0],[0,6],[6,12],[12,6],[6,0]].entries()){
      const cone=new THREE.Mesh(new THREE.ConeGeometry(.22,1,8),new THREE.MeshStandardMaterial({color:'#f07d26'}));cone.position.set(x,.5,-n);cone.name=`P${i+1}`;root.add(cone);markerLabel(root,cone.name,x,n);
    }
    // The 80x20 rectangle is a practice marking, the circular flight boundary remains separate.
    const outline=new THREE.Line(new THREE.BufferGeometry().setFromPoints([[-40,.09,2],[40,.09,2],[40,.09,-18],[-40,.09,-18],[-40,.09,2]].map(p=>new THREE.Vector3(...p))),new THREE.LineBasicMaterial({color:'#edce54'}));root.add(outline);
  }else{for(let i=0;i<12;i++){const a=i*Math.PI/6;tree(root,Math.cos(a)*24,Math.sin(a)*24,i,d.id);}box(root,12,8,3,2,3,'#bf8c5a');box(root,-10,14,2,3,2,'#718f9c');}
  return root;
}
const schema={type:'object',required:['ground','sky','radius','height'],properties:{ground:{type:'string'},sky:{type:'string'},radius:{type:'number'},height:{type:'number'}},additionalProperties:false};
export function createFreeSceneCatalog(){const c=new FreeSceneRegistry();
  const factory:SceneFactory={schema,create:smallScene,colliders:d=>d.id==='training'?[obstacle('training:box1',12,8,3,2,3),obstacle('training:box2',-10,14,2,3,2)]:d.id==='forest'?[...Array.from({length:4},(_,i)=>obstacle(`hill:${i}`,-17+i*11,23,10,4,10)),obstacle('forest:tent',9,10,3,2.5,3),...(()=>{const random=seededRandom(d.scene.seed);return Array.from({length:35},(_,i)=>{const a=random()*Math.PI*2,r=16+random()*18;return obstacle(`forest:tree:${i}`,Math.cos(a)*r,Math.sin(a)*r,2.8,4.8,2.8);});})()]:[]};
  c.factories.register('free-low-poly',factory);
  const town=(d:ChallengeDefinition)=>({...structuredClone(PHOTO_HUNT),id:d.id,scene:{...structuredClone(PHOTO_HUNT.scene),seed:d.scene.seed},spawn:d.spawn});
  c.factories.register('free-town',{schema,create:d=>{const root=foundation(d),townRoot=photoHuntScene.create(town(d));root.add(townRoot);const person=box(root,8,-19,.5,1.6,.5,'#d89a61');person.userData.annotationTarget={object_id:'urban:person',class_id:1,display_name:'行人'};const building=box(root,-29,8,5,9,6,'#bfac90');building.userData.annotationTarget={object_id:'urban:building',class_id:2,display_name:'街區大樓'};townRoot.traverse(o=>{const tag=o.userData.annotationTarget;if(tag)tag.object_id=`urban:${tag.object_id}`;});return root;},colliders:d=>[...d.scene.objects,...PHOTO_HUNT.scene.objects,...(photoHuntScene.colliders?.(town(d))??[]),obstacle('urban:building',-29,8,5,9,6),obstacle('urban:person',8,-19,.5,1.6,.5)]});
  const entries=[['training','基礎飛行場','草地、起降平台、樹木與低矮障礙物，練習起降與懸停。','基礎練習',35,15],['urban','城市街區','探索道路、建築、停車場、公園與貨櫃區，練習空拍。','城市探索',45,20],['forest','山林郊區','山丘、林地、湖泊與小路；請從平坦觀景區起降。','自然地景',40,20],['exam','考試練習場','雙圓、P1–P7 與 H 起降點。參考場地配置，非官方認證考場。','術科練習',60,50]] as const;
  for(const [id,title,description,category,radius,height] of entries){const d:FreeSceneDefinition={id,title,description,category,thumbnail:`/scenes/${id}.svg`,spawn_position:{east:0,north:id==='urban'?-24:0,up:0},spawn_heading:0,initial_camera_pose:{east:0,north:id==='urban'?-35:-12,up:5},flight_bounds:{radius},max_altitude:height,environment_settings:{preset:id==='forest'?'breeze':'calm',direction:90},scene:{type:id==='urban'?'free-town':'free-low-poly',seed:985,objects:[],environment:{wind:'calm',direction:90},params:{ground:'#97ad87',sky:'#c1d9e3',radius,height}}};c.registerScene(d);}return c;
}
