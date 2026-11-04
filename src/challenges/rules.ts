import type { RuleInput,RuleOutput,RuleInstance,ChallengeDefinition,ObjectiveProgress,Violation,RuleMetrics } from './types';
import { PluginRegistry,type RulePlugin } from './registry';
const n=(minimum:number,maximum:number)=>({type:'number',minimum,maximum});
const zoneSchema={type:'object',additionalProperties:false,required:['east','north','up','radius','hold_seconds','max_speed'],properties:{east:n(-45,45),north:n(-45,45),up:n(0,20),radius:n(.2,10),hold_seconds:n(.1,60),max_speed:n(.05,10)}};
export function createRuleRegistry(){return new PluginRegistry<RulePlugin>()
  .register('stay-zone',{schema:zoneSchema,create:p=>zone(p,false)})
  .register('land-zone',{schema:zoneSchema,create:p=>zone(p,true)})
  .register('flight-boundary',{schema:{type:'object',additionalProperties:false,required:['radius','max_altitude'],properties:{radius:n(1,50),max_altitude:n(1,20)}},create:p=>({evaluate:i=>({progress:0,complete:false,...(Math.hypot(i.drone.position.east,i.drone.position.north)>Number(p.radius)||i.drone.position.up>Number(p.max_altitude)?{failed:'超出關卡飛行範圍',violations:[{code:'BOUNDARY',message:'超出關卡飛行範圍',penalty:5,fatal:true}]}:{})})})})
  .register('collision',{schema:{type:'object',additionalProperties:false,required:['fatal','penalty'],properties:{fatal:{type:'boolean'},penalty:n(0,1000)}},create:p=>({evaluate:i=>({progress:0,complete:false,violations:i.events.filter(e=>e.type==='collision').map(e=>({code:'COLLISION',message:`碰撞：${e.id}`,penalty:Number(p.penalty),fatal:Boolean(p.fatal)})),...(p.fatal&&i.events.some(e=>e.type==='collision')?{failed:'碰撞障礙物'}:{})})})});}
function zone(p:Record<string,unknown>,land:boolean):RuleInstance {
  let held=0,precision=0;
  return{evaluate(i){const d=i.drone,dx=d.position.east-Number(p.east),dy=d.position.north-Number(p.north),dz=land?0:d.position.up-Number(p.up),distance=Math.hypot(dx,dy,dz);
    const inside=distance<=Number(p.radius)&&Math.hypot(d.velocity.east,d.velocity.north,d.velocity.up)<=Number(p.max_speed)&&
      (land?d.position.up<=.12&&(d.mode==='armed'||d.mode==='grounded'):d.mode==='flying');
    if(inside){held+=i.dt;precision+=Math.max(0,1-distance/Number(p.radius))*i.dt;}else{held=0;precision=0;}
    return{progress:Math.min(1,held/Number(p.hold_seconds)),complete:held+1e-9>=Number(p.hold_seconds),precision:held?precision/held:0,collected:held+1e-9>=Number(p.hold_seconds)?1:0};
  }};
}
export class ChallengeRuleEngine {
  private objectives:Array<{rule:RuleInstance;order:number;state:ObjectiveProgress}>;
  private rules:Array<{id:string;rule:RuleInstance}>;
  private violations:Violation[]=[];
  private telemetry:Record<string,RuleMetrics>={};
  private completedAt:number|undefined;
  constructor(definition:ChallengeDefinition,registry:PluginRegistry<RulePlugin>){
    this.objectives=definition.objectives.map(o=>({rule:registry.get(o.type).create(structuredClone(o.params)),order:o.order,state:{id:o.id,title:o.title,progress:0,completed:false,precision:0,collected:0}}));
    this.rules=definition.rules.map(r=>({id:r.id,rule:registry.get(r.type).create(structuredClone(r.params))}));
    for(const o of this.objectives)if(o.rule.metrics)this.telemetry[o.state.id]=o.rule.metrics();
  }
  evaluate(input:RuleInput):RuleOutput{
    let failed:string|null=null;const order=Math.min(...this.objectives.filter(o=>!o.state.completed).map(o=>o.order));
    const accept=(id:string,result:ReturnType<RuleInstance['evaluate']>)=>{
      if(result.metrics)this.telemetry[id]=result.metrics;
      if(result.complete&&result.completed_at!==undefined)this.completedAt=Math.max(this.completedAt??0,result.completed_at);
      for(const v of result.violations??[])this.violations.push({...v,rule_id:id,time:input.simulation_time});
      if(result.failed)failed=result.failed;
      if(result.violations?.some(v=>v.fatal))failed??='違反關卡規則';
    };
    for(const r of this.rules)accept(r.id,r.rule.evaluate(input));
    for(const o of this.objectives){if(o.state.completed||o.order!==order)continue;const result=o.rule.evaluate(input);accept(o.state.id,result);Object.assign(o.state,{progress:Math.max(0,Math.min(1,result.progress)),completed:result.complete,precision:result.precision??0,collected:result.collected??0});}
    return{objectives:this.progress(),violations:structuredClone(this.violations),completed:this.objectives.every(o=>o.state.completed),failed,metrics:this.metrics(),completed_at:this.completedAt};
  }
  metrics(){return structuredClone(this.telemetry);}
  progress(){return this.objectives.map(o=>({...o.state}));}
  dispose(){for(const o of this.objectives)o.rule.dispose?.();for(const r of this.rules)r.rule.dispose?.();}
}
