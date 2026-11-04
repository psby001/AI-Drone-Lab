import * as THREE from 'three';
import { buildScene,type SceneFactory } from '../scene';
import { selectHuntSpawns } from './definition';
import type { HuntParams } from './rule';
import type { SceneObject } from '../types';
const TREES:[number,number][]=[[9,12],[19,12],[10,21],[19,21],[6,25],[23,24],[-27,24],[-27,19],[-27,-5],[27,7],[26,13],[-4,25],[-25,-24],[26,-25]];
const color=(value:string)=>new THREE.MeshStandardMaterial({color:value,roughness:.9,flatShading:true});
function box(parent:THREE.Object3D,w:number,h:number,d:number,x:number,y:number,z:number,shade:string){const mesh=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),color(shade));mesh.position.set(x,y,z);parent.add(mesh);return mesh;}
export const photoHuntScene:SceneFactory={
  colliders(d){
    const targets=(d.objectives.find(o=>o.type==='photo-hunt')!.params as unknown as HuntParams).targets;
    const make=(id:string,e:number,n:number,w:number,h:number,depth:number):SceneObject=>({id,kind:'obstacle',position:{east:e,north:n,up:h/2},size:{east:w,north:depth,up:h},solid:true,color:'#777777'});
    return [...selectHuntSpawns(targets,d.scene.seed,d.scene.params.randomize===true).map(({target:t,position:p})=>{const size=t.class_name==='car'?[1.9,1.4,3.6]:t.class_name==='tent'?[3.6,2,3.6]:[2.56,2.6,6];return make(t.object_id,p.east,p.north,size[0],size[1],size[2]);}),...TREES.map(([e,n],i)=>make(`hunt-tree-${i}`,e,n,2.5,5.05,2.5)),...Array.from({length:12},(_,i)=>make(`hunt-lamp-${i}`,3.6,-26+i*4.5,.5,3.1,.35))];
  },
  schema:{type:'object',additionalProperties:false,required:['ground','sky','randomize'],properties:{ground:{type:'string',pattern:'^#[0-9a-fA-F]{6}$'},sky:{type:'string',pattern:'^#[0-9a-fA-F]{6}$'},randomize:{type:'boolean'}}},
  validateDefinition(d){const objectives=d.objectives.filter(o=>o.type==='photo-hunt');if(objectives.length!==1||d.scoring.type!=='photo-quality'||d.scoring.params.metric_id!==objectives[0].id||d.scoring.params.target_count!==(objectives[0].params as unknown as HuntParams).targets.length)throw new Error('攝影尋寶目標與計分須一致');},
  create(d){
    const root=buildScene({...d,scene:{...d.scene,objects:d.scene.objects.filter(o=>o.kind==='platform')}},false);root.name=`challenge:${d.id}`;
    // Shared low-poly meshes; repeated foliage and street lights are instanced.
    for(const o of d.scene.objects.filter(o=>o.kind!=='platform')){
      const g=new THREE.Group();g.position.set(o.position.east,o.position.up,-o.position.north);root.add(g);
      box(g,o.size.east,o.size.up,o.size.north,0,0,0,o.color);
      if(!o.id.startsWith('yard')&&!o.id.includes('wall')){
        box(g,o.size.east+.3,.25,o.size.north+.3,0,o.size.up/2+.08,0,'#716e64');
        for(let x=-o.size.east/2+.8;x<o.size.east/2;x+=1.6)box(g,.7,.8,.025,x,.4,o.size.north/2+.02,'#496d7e');
      }
    }
    // North/south main street plus east/west cross streets and regional ground colors.
    box(root,6,.04,62,0,.035,0,'#707d7b');for(const n of [-20,0,10])box(root,62,.04,4,0,.04,-n,'#707d7b');
    for(let n=-28;n<=28;n+=4)box(root,.12,.015,1.8,0,.065,-n,'#e8e3c5');
    box(root,12,.04,6,-16,.05,-5,'#8f9891');for(let x=-21;x<=-11;x+=2)box(root,.06,.02,4,x,.085,-5,'#e9e4c8');
    box(root,17,.04,13,14,.05,-16,'#83a377');box(root,18,.04,20,17,.05,10,'#b9b39c');
    const trees=TREES;
    const trunks=new THREE.InstancedMesh(new THREE.CylinderGeometry(.13,.20,2,5),color('#78654c'),trees.length),leaves=new THREE.InstancedMesh(new THREE.ConeGeometry(1.25,3.5,6),color('#4c7f58'),trees.length),matrix=new THREE.Matrix4();
    trees.forEach(([e,n],i)=>{trunks.setMatrixAt(i,matrix.makeTranslation(e,1,-n));leaves.setMatrixAt(i,matrix.makeTranslation(e,3.3,-n));});root.add(trunks,leaves);
    const lamps=new THREE.InstancedMesh(new THREE.CylinderGeometry(.07,.09,3,6),color('#4c5e63'),12);
    for(let i=0;i<12;i++){const n=-26+i*4.5;lamps.setMatrixAt(i,matrix.makeTranslation(3.6,1.5,-n));box(root,.5,.15,.35,3.6,3,-n,'#f7dc8c');}root.add(lamps);
    // Distinct target roots are opt-in Step 9 registry entries, never UI markers.
    const targets=(d.objectives.find(o=>o.type==='photo-hunt')!.params as unknown as HuntParams).targets;
    for(const {target:t,position:p} of selectHuntSpawns(targets,d.scene.seed,d.scene.params.randomize===true)){
      const g=new THREE.Group();g.position.set(p.east,p.up,-p.north);g.userData.annotationTarget={object_id:t.object_id,class_id:{car:0,tent:4,container:3}[t.class_name as 'car'|'tent'|'container'],display_name:t.display_name};root.add(g);
      if(t.class_name==='car'){
        box(g,1.7,.55,3.6,0,.6,0,'#d94435');box(g,1.4,.5,1.7,0,1.12,0,'#627f8c');
        for(const x of [-.85,.85])for(const z of [-1.15,1.15])box(g,.16,.5,.6,x,.35,z,'#253238');
      }else if(t.class_name==='tent'){
        const roof=new THREE.Mesh(new THREE.ConeGeometry(1.8,2,4),color('#f2ce46'));roof.position.y=1;g.add(roof);box(g,.7,.8,.04,0,.4,1.35,'#706a3e');
      }else{box(g,2.5,2.6,6,0,1.3,0,'#317ac5');for(let z=-2.7;z<=2.7;z+=.6)box(g,2.56,2.5,.035,0,1.3,z,'#3987cf');}
    }
    // Flight boundary is a visual perimeter; authoritative constraint remains the existing rule.
    const ring=new THREE.Mesh(new THREE.TorusGeometry(42,.08,5,96),color('#d2b36e'));ring.rotation.x=Math.PI/2;ring.position.y=.15;root.add(ring);
    return root;
  },
};
