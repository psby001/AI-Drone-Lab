import type { Vec3 } from '../core/coordinates';
import type { RuleInput,RuleInstance,RuleMetrics } from './types';
import type { RulePlugin,ScoringStrategy } from './registry';

export interface RacingWaypoint {waypoint_id:string;position:Vec3;radius:number;sequence:number;heading?:{degrees:number;tolerance:number};altitude?:{min:number;max:number}}
export interface RacingParams {
  start:Vec3;waypoints:RacingWaypoint[];d_allow:number;k:number;
  mode_bonus:{enabled:boolean;required_mode:'attitude';multiplier:number;qualification:'all_airborne'};
}
const number=(minimum:number,maximum:number)=>({type:'number',minimum,maximum});
const position={type:'object',additionalProperties:false,required:['east','north','up'],properties:{east:number(-40,40),north:number(-40,40),up:number(0,15)}};
export const racingSchema={type:'object',additionalProperties:false,required:['start','waypoints','d_allow','k','mode_bonus'],properties:{
  start:position,d_allow:number(0,20),k:number(0,100),
  waypoints:{type:'array',minItems:3,maxItems:5,items:{type:'object',additionalProperties:false,required:['waypoint_id','position','radius','sequence'],properties:{waypoint_id:{type:'string',minLength:1,maxLength:80},position,radius:number(.2,5),sequence:{type:'integer',minimum:0,maximum:100},heading:{type:'object',additionalProperties:false,required:['degrees','tolerance'],properties:{degrees:number(0,360),tolerance:number(0,180)}},altitude:{type:'object',additionalProperties:false,required:['min','max'],properties:{min:number(0,15),max:number(0,15)}}}}},
  mode_bonus:{type:'object',additionalProperties:false,required:['enabled','required_mode','multiplier','qualification'],properties:{enabled:{type:'boolean'},required_mode:{const:'attitude'},multiplier:number(.1,1),qualification:{const:'all_airborne'}}},
}};
export function racingParams(params:Record<string,unknown>):RacingParams {
  const p=params as unknown as RacingParams;
  if(new Set(p.waypoints.map(w=>w.waypoint_id)).size!==p.waypoints.length||p.waypoints.some((w,i)=>i>0&&w.sequence<=p.waypoints[i-1].sequence))throw new Error('航點 ID 須唯一且 sequence 須嚴格遞增');
  for(const w of p.waypoints){if(w.altitude&&w.altitude.min>w.altitude.max)throw new Error('航點高度範圍不合法');if(Math.hypot(w.position.east,w.position.north)+w.radius>45)throw new Error('航點觸發球須位於 45m 安全範圍內');}
  return p;
}
export const lerpPosition=(a:Vec3,b:Vec3,t:number):Vec3=>({east:a.east+(b.east-a.east)*t,north:a.north+(b.north-a.north)*t,up:a.up+(b.up-a.up)*t});
const dot=(a:Vec3,b:Vec3)=>a.east*b.east+a.north*b.north+a.up*b.up;
const subtract=(a:Vec3,b:Vec3):Vec3=>({east:a.east-b.east,north:a.north-b.north,up:a.up-b.up});
export function distanceToSegment(point:Vec3,a:Vec3,b:Vec3){const ab=subtract(b,a),length=dot(ab,ab),t=length?Math.max(0,Math.min(1,dot(subtract(point,a),ab)/length)):0;const d=subtract(point,lerpPosition(a,b,t));return Math.hypot(d.east,d.north,d.up);}
/** Earliest t on the continuous segment satisfying sphere, altitude AND heading. */
export function waypointEntry(a:Vec3,b:Vec3,w:RacingWaypoint,fromHeading:number,toHeading:number,cursor=0):number|null {
  const delta=subtract(b,a),offset=subtract(a,w.position),A=dot(delta,delta),B=2*dot(offset,delta),C=dot(offset,offset)-w.radius*w.radius;
  let low=cursor,high=1;
  if(A<1e-16){if(C>1e-10)return null;}else{const discriminant=B*B-4*A*C;if(discriminant<-1e-10)return null;const root=Math.sqrt(Math.max(0,discriminant));low=Math.max(low,(-B-root)/(2*A));high=Math.min(high,(-B+root)/(2*A));}
  if(w.altitude){const dz=b.up-a.up;if(Math.abs(dz)<1e-12){if(a.up<w.altitude.min||a.up>w.altitude.max)return null;}else{const t0=(w.altitude.min-a.up)/dz,t1=(w.altitude.max-a.up)/dz;low=Math.max(low,Math.min(t0,t1));high=Math.min(high,Math.max(t0,t1));}}
  if(low>high+1e-10||high<0||low>1)return null;low=Math.max(0,low);high=Math.min(1,high);
  if(!w.heading)return low;
  const turn=((toHeading-fromHeading+540)%360)-180;
  for(let n=-3;n<=3;n++){const target=w.heading.degrees+360*n,lo=target-w.heading.tolerance,hi=target+w.heading.tolerance;
    if(Math.abs(turn)<1e-12){if(fromHeading>=lo&&fromHeading<=hi)return low;}
    else{const t0=(lo-fromHeading)/turn,t1=(hi-fromHeading)/turn,l=Math.max(low,Math.min(t0,t1)),h=Math.min(high,Math.max(t0,t1));if(l<=h+1e-10)return l;}
  }return null;
}
/** Integrate in simulation seconds using small subintervals + Gaussian quadrature.
 * No endpoint-per-frame accumulation; waypoint transitions split the same swept segment. */
export function deviationIntegral(a:Vec3,b:Vec3,routeA:Vec3,routeB:Vec3,dt:number,dAllow:number,k:number){
  if(dt<=0||k===0)return 0;let sum=0;const count=Math.max(1,Math.ceil(dt*240)),nodes=[-.7745966692414834,0,.7745966692414834],weights=[5/9,8/9,5/9];
  for(let i=0;i<count;i++)for(let j=0;j<3;j++){const t=(i+.5+nodes[j]/2)/count;sum+=weights[j]*Math.max(0,distanceToSegment(lerpPosition(a,b,t),routeA,routeB)-dAllow)*dt/(2*count)*k;}
  return sum;
}
export class WaypointRace implements RuleInstance {
  private index=0;private penalty=0;private airborne=0;private qualifiedTime=0;private disqualified=false;private nextDistance=0;private doneAt:number|undefined;
  constructor(readonly params:RacingParams) {this.nextDistance=Math.hypot(...Object.values(subtract(params.start,params.waypoints[0].position)));}
  metrics():RuleMetrics{const p=this.params,qualified=p.mode_bonus.enabled&&!this.disqualified&&this.airborne>0;return{completed_waypoints:this.index,total_waypoints:p.waypoints.length,current_waypoint:p.waypoints[this.index]?.waypoint_id??'FINISH',next_distance:this.index===p.waypoints.length?0:this.nextDistance,deviation_penalty:this.penalty,mode_multiplier:qualified?p.mode_bonus.multiplier:1,mode_qualified:qualified,mode_bonus_enabled:p.mode_bonus.enabled,airborne_time:this.airborne,qualified_time:this.qualifiedTime,mode_disqualified:this.disqualified,mode_qualification:'全程空中使用姿態（定高輔助）模式'};}
  evaluate(input:RuleInput){
    const {drone,previous,dt}=input,p=this.params,a=previous?.position??drone.position,b=drone.position;
    if(input.events.some(e=>e.type==='mission'&&['failed','stopped','aborted'].includes(e.id)))return{progress:this.index/p.waypoints.length,complete:false,failed:'自動任務失敗或中止',metrics:this.metrics()};
    let cursor=0;
    while(this.index<p.waypoints.length){const target=p.waypoints[this.index],hit=drone.mode==='flying'||drone.mode==='landing'?waypointEntry(a,b,target,previous?.heading??drone.heading,drone.heading,cursor):null;
      const end=hit??1,routeA=this.index?p.waypoints[this.index-1].position:p.start;
      this.penalty+=deviationIntegral(lerpPosition(a,b,cursor),lerpPosition(a,b,end),routeA,target.position,(end-cursor)*dt,p.d_allow,p.k);
      if(hit===null)break;this.index++;cursor=hit;
      if(this.index===p.waypoints.length){this.doneAt=input.simulation_time-dt+hit*dt;break;}
    }
    const used=this.doneAt===undefined?dt:Math.max(0,this.doneAt-(input.simulation_time-dt));
    const currentAir=drone.mode==='flying'||drone.mode==='landing',previousAir=previous?.mode==='flying'||previous?.mode==='landing';
    if(currentAir||previousAir){this.airborne+=used;const valid=(!currentAir||drone.controlMode===p.mode_bonus.required_mode)&&(!previousAir||previous?.controlMode===p.mode_bonus.required_mode);if(valid)this.qualifiedTime+=used;else this.disqualified=true;}
    const target=p.waypoints[this.index];if(target){const d=subtract(b,target.position);this.nextDistance=Math.hypot(d.east,d.north,d.up);}
    return{progress:this.index/p.waypoints.length,complete:this.index===p.waypoints.length,collected:this.index,metrics:this.metrics(),completed_at:this.doneAt};
  }
}
export const waypointRacePlugin:RulePlugin={schema:racingSchema,validate:p=>{racingParams(p);},create:p=>new WaypointRace(structuredClone(racingParams(p)))};
export const raceTimeScoring:ScoringStrategy={schema:{type:'object',additionalProperties:false,required:['metric_id'],properties:{metric_id:{type:'string',minLength:1}}},score:(context,params)=>{
  const metrics=context.metrics?.[String(params.metric_id)]??{},penalty=Number(metrics.deviation_penalty??0),multiplier=Number(metrics.mode_multiplier??1),base=context.completion_time+penalty;
  return{final_score:Math.round(base*multiplier*1000)/1000,score_unit:'秒',score_direction:'lower',penalties:[{label:'偏離航線加時',value:penalty}],bonuses:[{label:`模式倍率 ×${multiplier.toFixed(2)}`,value:base*(multiplier-1)}],lines:[{label:'飛行時間',value:context.completion_time},{label:'偏離加時',value:penalty},{label:`模式加成 ×${multiplier.toFixed(2)}`,value:base*(multiplier-1)},{label:'最終等效時間',value:base*multiplier}]};
}};
