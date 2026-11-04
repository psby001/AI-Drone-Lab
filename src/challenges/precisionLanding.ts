import * as THREE from 'three';
import type { Vec3 } from '../core/coordinates';
import { toScene } from '../core/coordinates';
import type { ChallengeDefinition,RuleInput,RuleInstance,RuleMetrics } from './types';
import type { RulePlugin,ScoringStrategy } from './registry';
import { buildScene,type SceneFactory } from './scene';

export interface LandingParams {target:Vec3;min_takeoff_altitude:number;touchdown_height:number;settle_seconds:number;max_landing_speed:number;max_error:number}
export interface LandingScoreParams {metric_id:string;bands:Array<{max_error:number;score:number}>}
const n=(minimum:number,maximum:number)=>({type:'number',minimum,maximum});
const targetSchema={type:'object',additionalProperties:false,required:['east','north','up'],properties:{east:n(-30,30),north:n(-30,30),up:{const:0}}};
export const landingSchema={type:'object',additionalProperties:false,required:['target','min_takeoff_altitude','touchdown_height','settle_seconds','max_landing_speed','max_error'],properties:{target:targetSchema,min_takeoff_altitude:n(.5,10),touchdown_height:n(0,.2),settle_seconds:n(.1,5),max_landing_speed:n(.01,1),max_error:n(.5,10)}};
export const landingScoreSchema={type:'object',additionalProperties:false,required:['metric_id','bands'],properties:{metric_id:{type:'string',minLength:1},bands:{type:'array',minItems:1,maxItems:10,items:{type:'object',additionalProperties:false,required:['max_error','score'],properties:{max_error:n(.01,10),score:n(0,1000)}}}}};
export function landingScoreParams(params:Record<string,unknown>){const p=params as unknown as LandingScoreParams;if(p.bands.some((b,i)=>i>0&&(b.max_error<=p.bands[i-1].max_error||b.score>p.bands[i-1].score)))throw new Error('落點分段距離須遞增，分數須遞減或相同');return p;}

/** Pure observation of actual flight; neither a land command nor ground-idle can earn points. */
export class PrecisionLandingRule implements RuleInstance {
  private leftGround=false;private qualified=false;private contact:Vec3|null=null;private settled=0;private distance=-1;
  constructor(readonly params:LandingParams){}
  metrics():RuleMetrics {return{airborne_seen:this.leftGround,takeoff_qualified:this.qualified,landed:this.contact!==null,landing_error:this.contact?this.error(this.contact):-1,horizontal_distance:this.distance,settle_progress:Math.min(1,this.settled/this.params.settle_seconds),landing_east:this.contact?.east??0,landing_north:this.contact?.north??0};}
  private error(p:Vec3){return Math.hypot(p.east-this.params.target.east,p.north-this.params.target.north);}
  evaluate(input:RuleInput){
    const d=input.drone,p=this.params;this.distance=this.error(d.position);
    const air=d.mode==='flying'||d.mode==='landing';
    if(air&&d.position.up>.2)this.leftGround=true;
    if(air&&d.position.up>=p.min_takeoff_altitude)this.qualified=true;
    let failed:string|undefined;
    if(input.events.some(e=>e.type==='mission'&&['failed','stopped','aborted'].includes(e.id)))failed='自動任務失敗或中止';
    const grounded=(d.mode==='armed'||d.mode==='grounded')&&d.position.up<=p.touchdown_height;
    if(this.leftGround&&grounded){
      this.contact??={...d.position}; // Freeze the FIRST actual contact position, never a later slide/reposition.
      if(!this.qualified)failed='未達指定起飛高度便落地';
      else if(this.error(this.contact)>p.max_error+1e-9)failed='落點超出目標容許範圍';
      if(Math.hypot(d.velocity.east,d.velocity.north,d.velocity.up)<=p.max_landing_speed)this.settled+=input.dt;else this.settled=0;
    }else{
      this.settled=0;if(this.contact&&air)failed='首次落地後再次起飛，請重新挑戰';
    }
    const complete=!failed&&this.contact!==null&&this.qualified&&this.settled+1e-9>=p.settle_seconds;
    return{progress:complete?1:this.contact?.8:this.qualified?.5:this.leftGround?.2:0,complete,failed,precision:this.contact?Math.max(0,1-this.error(this.contact)/p.max_error):0,metrics:this.metrics()};
  }
}
export const precisionLandingPlugin:RulePlugin={schema:landingSchema,create:p=>new PrecisionLandingRule(structuredClone(p as unknown as LandingParams))};
export const precisionLandingScoring:ScoringStrategy={schema:landingScoreSchema,validate:p=>{landingScoreParams(p);},score:(context,params)=>{
  const p=landingScoreParams(params),m=context.metrics?.[p.metric_id]??{},error=Number(m.landing_error??-1),score=context.completed&&m.landed===true&&error>=0?p.bands.find(b=>error<=b.max_error+1e-9)?.score??0:0;
  return{final_score:score,score_unit:'分',score_direction:'higher',penalties:[],bonuses:[],lines:[{label:error>=0?'首次落點誤差（m）':'尚無有效落點（-1）',value:error},{label:'精準降落分數',value:score}]};
}};
export const precisionLandingScene:SceneFactory={
  schema:{type:'object',additionalProperties:false,required:['ground','sky'],properties:{ground:{type:'string',pattern:'^#[0-9a-fA-F]{6}$'},sky:{type:'string',pattern:'^#[0-9a-fA-F]{6}$'}}},
  validateDefinition(d){
    const objectives=d.objectives.filter(o=>o.type==='precision-landing');if(objectives.length!==1)throw new Error('精準降落場景須有一個降落目標');const o=objectives[0],p=o.params as unknown as LandingParams;
    if(d.scoring.type!=='landing-accuracy'||d.scoring.params.metric_id!==o.id)throw new Error('精準降落計分須對應降落目標');
    const score=landingScoreParams(d.scoring.params);if(Math.abs(score.bands.at(-1)!.max_error-p.max_error)>1e-9)throw new Error('計分最外圈須與失敗距離一致');
    if(Math.hypot(p.target.east,p.target.north)+p.max_error>45)throw new Error('降落區須在安全範圍內');
  },
  create(d){
    const group=buildScene(d,true);group.name=`challenge:${d.id}`;
    const objective=d.objectives.find(o=>o.type==='precision-landing')!,p=objective.params as unknown as LandingParams,bands=landingScoreParams(d.scoring.params).bands;
    const colors=['#409b78','#75b681','#dfbb61','#ce8e54'];
    [...bands].reverse().forEach((b,i)=>{const mesh=new THREE.Mesh(new THREE.CircleGeometry(b.max_error,64),new THREE.MeshStandardMaterial({color:colors[Math.min(bands.length-1-i,3)],roughness:.9}));mesh.rotation.x=-Math.PI/2;mesh.position.set(p.target.east,.09+i*.002,-p.target.north);group.add(mesh);});
    const cross=new THREE.Group();cross.position.set(...toScene(p.target));
    for(const [width,depth] of [[.8,.055],[.055,.8]]){const bar=new THREE.Mesh(new THREE.BoxGeometry(width,.02,depth),new THREE.MeshStandardMaterial({color:'#ffffff'}));bar.position.y=.12;cross.add(bar);}group.add(cross);
    return group;
  },
};
export const PRECISION_LANDING:ChallengeDefinition={
  id:'precision-landing',version:'1.0.0',title:'精準降落 Precision Landing',description:'從指定平台起飛至少 1m，移動至彩色同心圓目標後落地。以第一次實際接地位置計算水平誤差，低速穩定 0.6 秒後結算；超過 3m 失敗。',difficulty:'beginner',thumbnail:'/challenges/precision-landing.svg',
  scene:{type:'precision-landing-field',seed:85,params:{ground:'#c4c5b1',sky:'#d4deed'},environment:{wind:'calm',direction:90},objects:[{id:'landing-launch',kind:'platform',position:{east:-3,north:-2,up:0},size:{east:2,north:2,up:.08},color:'#314d55',solid:false}]},
  spawn:{position:{east:-3,north:-2,up:0},heading:0},objectives:[{id:'landing-target',title:'起飛後降落於目標區',order:0,type:'precision-landing',params:{target:{east:4,north:6,up:0},min_takeoff_altitude:1,touchdown_height:.12,settle_seconds:.6,max_landing_speed:.5,max_error:3}}],
  rules:[{id:'landing-boundary',type:'flight-boundary',params:{radius:25,max_altitude:12}},{id:'landing-collision',type:'collision',params:{fatal:true,penalty:0}}],scoring:{type:'landing-accuracy',params:{metric_id:'landing-target',bands:[{max_error:.5,score:100},{max_error:1,score:80},{max_error:2,score:60},{max_error:3,score:40}]}},allowed_control_modes:['MANUAL','AI_MISSION','MIXED'],time_limit:180,
  metadata:{author:'AI Drone Lab',experience:'precision-landing',scoring_rules:['水平落點誤差 ≤0.5m：100 分；≤1m：80 分；≤2m：60 分；≤3m：40 分；超過 3m 失敗。','須實際起飛至至少 1m；第一次接地後低速穩定 0.6 秒。單純呼叫 land 或停在出生平台不會完成。','目標為世界 ENU (4,6,0)，本關起點 (-3,-2,0)；goto_local 使用相對起點 (7,8,3)。'],example_mission:{version:'1.2',name:'精準降落：自動測試',commands:[{action:'set_speed',speed:2},{action:'takeoff',altitude:3},{action:'goto_local',x:7,y:8,z:3},{action:'hover',duration:1},{action:'land'}]}},
};
