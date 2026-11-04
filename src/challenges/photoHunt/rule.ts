import type { RulePlugin,ScoringStrategy } from '../registry';
import type { RuleInput,RuleInstance,RuleMetrics } from '../types';
import type { HuntTarget,PhotoEvaluationResult } from './scoring';
export interface HuntParams {targets:HuntTarget[]}
const number=(minimum:number,maximum:number)=>({type:'number',minimum,maximum});
const scoreProperties={min_visibility:number(0,1),min_in_frame:number(0,1),min_area:number(.001,.5),ideal_area_min:number(.001,.8),ideal_area_max:number(.001,.9),oversize_floor:number(0,1),visibility_points:number(0,100),composition_points:number(0,100),size_points:number(0,100)};
export const huntSchema={type:'object',additionalProperties:false,required:['targets'],properties:{targets:{type:'array',minItems:1,maxItems:10,items:{type:'object',additionalProperties:false,required:['object_id','class_name','display_name','target_description','spawn_candidates','scoring_config'],properties:{object_id:{type:'string',pattern:'^[a-z0-9-]+$'},class_name:{enum:['car','tent','container']},display_name:{type:'string',minLength:1},target_description:{type:'string'},spawn_candidates:{type:'array',minItems:1,maxItems:10,items:{type:'object',additionalProperties:false,required:['east','north','up'],properties:{east:number(-35,35),north:number(-35,35),up:{const:0}}}},scoring_config:{type:'object',additionalProperties:false,required:Object.keys(scoreProperties),properties:scoreProperties}}}}}};
export function validateHunt(p:Record<string,unknown>){const {targets}=p as unknown as HuntParams;if(new Set(targets.map(t=>t.object_id)).size!==targets.length)throw new Error('尋寶目標 ID 不可重複');for(const t of targets){const c=t.scoring_config;if(!(c.min_area<c.ideal_area_min&&c.ideal_area_min<=c.ideal_area_max)||Math.abs(c.visibility_points+c.composition_points+c.size_points-100)>1e-9)throw new Error('攝影計分曲線與權重設定錯誤');}}
export interface PhotoFeedback {photo_id:string;timestamp:number;elapsed:number;evaluations:PhotoEvaluationResult[]}
export interface HuntProgress {shot_count:number;found:number;best:Record<string,PhotoEvaluationResult>;latest:PhotoFeedback|null;history:PhotoFeedback[]}
export function readHuntProgress(metrics:RuleMetrics|undefined):HuntProgress {try{return JSON.parse(String(metrics?.photo_progress??''));}catch{return{shot_count:0,found:0,best:{},latest:null,history:[]};}}
export class PhotoHuntRule implements RuleInstance {
  private state:HuntProgress={shot_count:0,found:0,best:{},latest:null,history:[]};private seen=new Set<string>();private completedAt:number|undefined;private cachedMetrics:RuleMetrics|null=null;
  constructor(readonly params:HuntParams){}
  metrics():RuleMetrics{return this.cachedMetrics??={found:this.state.found,shot_count:this.state.shot_count,photo_progress:JSON.stringify(this.state)};}
  evaluate(input:RuleInput){
    for(const event of input.events){if(event.type!=='camera'||event.id!=='photo-hunt-evaluated')continue;
      const f=event.data?.feedback as unknown as PhotoFeedback|undefined;
      if(!f||!f.photo_id||this.seen.has(f.photo_id)||!Number.isFinite(f.elapsed)||f.elapsed<0||f.elapsed>input.simulation_time+1e-6||!Array.isArray(f.evaluations))continue;
      this.cachedMetrics=null;this.seen.add(f.photo_id);this.state.shot_count++;this.state.latest=structuredClone(f);this.state.history.push(structuredClone(f));if(this.state.history.length>30)this.state.history.shift();
      for(const t of this.params.targets){const e=f.evaluations.find(e=>e.target_id===t.object_id&&e.photo_id===f.photo_id);if(!e?.is_valid||!Number.isFinite(e.total_score)||e.total_score<0||e.total_score>100)continue;const old=this.state.best[t.object_id];if(!old||e.total_score>old.total_score)this.state.best[t.object_id]=structuredClone(e);}
      this.state.found=Object.keys(this.state.best).length;
      if(this.state.found===this.params.targets.length)this.completedAt=f.elapsed;
    }
    return{progress:this.state.found/this.params.targets.length,complete:this.state.found===this.params.targets.length,collected:this.state.found,metrics:this.metrics(),completed_at:this.completedAt};
  }
}
export const photoHuntPlugin:RulePlugin={schema:huntSchema,validate:validateHunt,create:p=>new PhotoHuntRule(structuredClone(p as unknown as HuntParams))};
export const photoHuntScoring:ScoringStrategy={schema:{type:'object',additionalProperties:false,required:['metric_id','target_count'],properties:{metric_id:{type:'string'},target_count:{type:'integer',minimum:1,maximum:10}}},score:(context,p)=>{
  const s=readHuntProgress(context.metrics?.[String(p.metric_id)]),best=Object.values(s.best),average=best.reduce((n,e)=>n+e.total_score,0)/Number(p.target_count);
  return{final_score:Math.round(average*100)/100,score_unit:'分',score_direction:'higher',penalties:[],bonuses:[],lines:[{label:'有效目標數量',value:best.length},{label:'拍照次數',value:s.shot_count},{label:'完成／探索時間（秒）',value:context.completion_time},...best.map(e=>({label:e.target_id,value:e.total_score})),{label:'平均攝影分數（未找到目標以 0 分計）',value:average}]};
}};
