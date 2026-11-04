import * as THREE from 'three';
import { toScene } from '../core/coordinates';
import { buildScene,type SceneFactory } from './scene';
import { racingParams } from './racing';
export const RACE_COLORS={completed:'#41aa80',current:'#f2b744',pending:'#6fa1b9'};
function label(group:THREE.Group,text:string,position:THREE.Vector3){
  if(typeof document==='undefined')return;
  const canvas=document.createElement('canvas');canvas.width=256;canvas.height=96;const context=canvas.getContext('2d');if(!context)return;
  context.fillStyle='#183d43';context.fillRect(0,0,256,96);context.fillStyle='#ffffff';context.textAlign='center';context.textBaseline='middle';context.font='bold 42px sans-serif';context.fillText(text,128,50);
  const material=new THREE.MeshBasicMaterial({map:new THREE.CanvasTexture(canvas),side:THREE.DoubleSide}),mesh=new THREE.Mesh(new THREE.PlaneGeometry(1.6,.6),material);mesh.position.copy(position);group.add(mesh);
}
export const racingSceneFactory:SceneFactory={
  schema:{type:'object',additionalProperties:false,required:['ground','sky','radius','max_altitude'],properties:{ground:{type:'string',pattern:'^#[0-9a-fA-F]{6}$'},sky:{type:'string',pattern:'^#[0-9a-fA-F]{6}$'},radius:{type:'number',minimum:10,maximum:45},max_altitude:{type:'number',minimum:5,maximum:20}}},
  validateDefinition(d){
    const routes=d.objectives.filter(o=>o.type==='waypoint-race');if(routes.length!==1)throw new Error('競速場景須有且僅有一條競速航線');const route=routes[0],p=racingParams(route.params);
    if(d.scoring.type==='race-time'&&d.scoring.params.metric_id!==route.id)throw new Error('競速計分 metric_id 必須對應競速目標');
    if(['east','north','up'].some(axis=>p.start[axis as keyof typeof p.start]!==d.spawn.position[axis as keyof typeof p.start]))throw new Error('競速起點必須與出生點一致');
    if(p.waypoints.some(w=>Math.hypot(w.position.east,w.position.north)+w.radius>Number(d.scene.params.radius)||w.position.up+w.radius>Number(d.scene.params.max_altitude)))throw new Error('航點觸發球須位於競速邊界內');
  },
  create(definition){
    const group=buildScene(definition,false),route=definition.objectives.find(o=>o.type==='waypoint-race');if(!route)throw new Error('競速場景需要 waypoint-race 目標');
    const params=racingParams(route.params);group.userData.metricId=route.id;
    const points=[params.start,...params.waypoints.map(w=>w.position)].map(p=>new THREE.Vector3(...toScene(p)));
    const path=new THREE.Line(new THREE.BufferGeometry().setFromPoints(points),new THREE.LineDashedMaterial({color:0xe0a83f,dashSize:.45,gapSize:.25}));path.computeLineDistances();group.add(path);
    const ground=new THREE.Line(new THREE.BufferGeometry().setFromPoints(points.map(p=>new THREE.Vector3(p.x,.025,p.z))),new THREE.LineBasicMaterial({color:0xe8ede3}));group.add(ground);
    params.waypoints.forEach((w,i)=>{
      const marker=new THREE.Group();marker.name=`race-waypoint-${i}`;marker.position.set(...toScene(w.position));
      const color=i===0?RACE_COLORS.current:RACE_COLORS.pending;
      marker.add(new THREE.Mesh(new THREE.SphereGeometry(w.radius,24,14),new THREE.MeshStandardMaterial({color,transparent:true,opacity:.14,depthWrite:false})));
      const ring=new THREE.Mesh(new THREE.TorusGeometry(w.radius,.06,8,48),new THREE.MeshStandardMaterial({color,emissive:color,emissiveIntensity:.15}));marker.add(ring);
      const equator=ring.clone();equator.material=ring.material.clone();equator.rotation.x=Math.PI/2;marker.add(equator);group.add(marker);
      label(group,i===params.waypoints.length-1?'FINISH':`WP ${i+1}`,marker.position.clone().add(new THREE.Vector3(0,w.radius+.45,0)));
      const disk=new THREE.Mesh(new THREE.RingGeometry(.25,.4,24),new THREE.MeshBasicMaterial({color}));disk.rotation.x=-Math.PI/2;disk.position.set(marker.position.x,.03,marker.position.z);disk.name=`race-ground-${i}`;group.add(disk);
    });
    label(group,'START',new THREE.Vector3(-2,1,1));
    const radius=Number(definition.scene.params.radius),height=Number(definition.scene.params.max_altitude),cylinder=new THREE.CylinderGeometry(radius,radius,height,64,1,true);
    const boundary=new THREE.LineSegments(new THREE.EdgesGeometry(cylinder),new THREE.LineBasicMaterial({color:0xd39e49,transparent:true,opacity:.65}));cylinder.dispose();boundary.position.y=height/2;group.add(boundary);
    return group;
  },
  update(group,snapshot){
    const index=Number(snapshot.metrics[String(group.userData.metricId)]?.completed_waypoints??0);if(group.userData.lastIndex===index)return;group.userData.lastIndex=index;
    for(let i=0;i<5;i++){const color=i<index?RACE_COLORS.completed:i===index?RACE_COLORS.current:RACE_COLORS.pending;
      group.getObjectByName(`race-waypoint-${i}`)?.traverse(o=>{if(o instanceof THREE.Mesh){const m=o.material as THREE.MeshStandardMaterial;m.color.set(color);m.emissive?.set(color);}});
      const disk=group.getObjectByName(`race-ground-${i}`) as THREE.Mesh|undefined;if(disk)(disk.material as THREE.MeshBasicMaterial).color.set(color);
    }
  },
};
