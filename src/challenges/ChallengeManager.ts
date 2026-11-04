import type { FlightState } from '../core/flight';
import type { ChallengeRegistry,PluginRegistry,RulePlugin,ScoringStrategy } from './registry';
import { ChallengeRuleEngine } from './rules';
import { challengeSettingsKey as courseKey } from './identity';
import { betterResult } from './repository';
import type { ChallengeDefinition,ChallengeEvent,ChallengeResult,ChallengeSceneHandle,ChallengeSceneProvider,ChallengeSnapshot,ControlSource,ResultRepository } from './types';
export interface ChallengeHost {
  /** Initialization only; all flight after countdown still uses the existing FlightModel. */
  initialize(definition:ChallengeDefinition):void;
  stop():void;
  clearInput?():void;
}
const empty=():ChallengeSnapshot=>({status:'IDLE',definition:null,countdown:0,elapsed:0,objectives:[],violations:[],result:null,message:'請選擇挑戰',storage_error:'',metrics:{},control_source:'MANUAL',flight_mode:'position'});
const terminal=new Set(['COMPLETED','FAILED','ABORTED']);
/** randomUUID is restricted to secure contexts; LAN HTTP still supports getRandomValues. */
export function createAttemptId(){return `attempt-${Array.from(globalThis.crypto.getRandomValues(new Uint32Array(4)),n=>n.toString(16).padStart(8,'0')).join('')}`;}
export class ChallengeManager {
  private state=empty();private listeners=new Set<()=>void>();
  private provider:ChallengeSceneProvider|null=null;private scene:ChallengeSceneHandle|null=null;
  private loading:AbortController|null=null;private engine:ChallengeRuleEngine|null=null;
  private previous:FlightState|null=null;private history:Array<{source:ControlSource;time:number}>=[];
  private trajectory:ChallengeResult['trajectory_summary']={distance:0,max_altitude:0,samples:0,start:null,end:null};
  private attemptId='';private pauseFrom:'RUNNING'|'COUNTDOWN'='RUNNING';private disposed=false;
  private pendingEvents:ChallengeEvent[]=[];
  get attemptToken(){return this.attemptId;}
  /** Async sensors may enqueue only for the same still-active attempt. */
  queueEvent(event:ChallengeEvent,attemptToken:string){if(attemptToken!==this.attemptId||!['RUNNING','PAUSED'].includes(this.state.status))return false;if(this.pendingEvents.length>=64)return false;this.pendingEvents.push(structuredClone(event));return true;}
  constructor(readonly registry:ChallengeRegistry,private rules:PluginRegistry<RulePlugin>,private scoring:PluginRegistry<ScoringStrategy>,private repository:ResultRepository,private host:ChallengeHost,private clock=()=>new Date(),private id:()=>string=createAttemptId){}
  get snapshot(){return this.state;}
  subscribe=(listener:()=>void)=>{this.listeners.add(listener);return()=>{this.listeners.delete(listener);};};
  private patch(patch:Partial<ChallengeSnapshot>,notify=true){this.state={...this.state,...patch};if(notify)for(const listener of this.listeners)listener();}
  storageWarning(message:string){this.patch({storage_error:message});}
  get freezesFlight(){return this.state.status!=='IDLE'&&this.state.status!=='RUNNING';}
  get active(){return ['COUNTDOWN','RUNNING','PAUSED'].includes(this.state.status);}
  setSceneProvider(provider:ChallengeSceneProvider|null){if(this.provider===provider)return;this.menu();this.provider=provider;}
  private unload(){this.pendingEvents=[];this.loading?.abort();this.loading=null;this.scene?.dispose();this.scene=null;this.engine?.dispose();this.engine=null;}
  async select(id:string,seed?:number){
    if(this.disposed)throw new Error('ChallengeManager 已釋放');
    const definition=this.registry.get(id);if(seed!==undefined){if(!Number.isInteger(seed)||seed<0||seed>4294967295)throw new Error('Seed 須為 uint32');definition.scene.seed=seed;}if(this.active)this.finish('ABORTED','切換關卡');this.host.stop();this.unload();
    const controller=new AbortController();this.loading=controller;
    this.patch({...empty(),storage_error:this.state.storage_error,status:'LOADING',definition,message:'載入關卡場景…'});
    let scene:ChallengeSceneHandle|null=null;
    try{
      if(!this.provider)throw new Error('3D 場景尚未就緒');
      scene=await this.provider.load(definition,controller.signal);
      if(controller.signal.aborted||this.disposed){scene.dispose();return;}
      this.scene=scene;this.engine=new ChallengeRuleEngine(definition,this.rules);this.host.initialize(definition);
      this.patch({status:'READY',objectives:this.engine.progress(),metrics:this.engine.metrics(),message:'場景已就緒，開始後倒數 3 秒'});this.scene.update?.(this.state);
    }catch(error){if(controller.signal.aborted)return;scene?.dispose();this.scene=null;this.engine?.dispose();this.engine=null;this.patch({status:'FAILED',message:error instanceof Error?error.message:'載入失敗'});}
  }
  start(){if(this.state.status!=='READY'||!this.engine)return false;this.host.clearInput?.();this.attemptId=this.id();this.history=[];this.previous=null;this.trajectory={distance:0,max_altitude:0,samples:0,start:null,end:null};this.patch({status:'COUNTDOWN',countdown:3,elapsed:0,result:null,message:'準備起飛'});return true;}
  pause(){if(this.state.status==='RUNNING'||this.state.status==='COUNTDOWN'){this.host.clearInput?.();this.pauseFrom=this.state.status;this.patch({status:'PAUSED',message:'挑戰與飛行均已暫停'});}}
  resume(){if(this.state.status==='PAUSED'){this.host.clearInput?.();this.patch({status:this.pauseFrom,message:'繼續挑戰'});}}
  abort(reason='使用者中止挑戰'){if(this.active)this.finish('ABORTED',reason);}
  retry(seed=this.state.definition?.scene.seed){const id=this.state.definition?.id;return id?this.select(id,seed):Promise.resolve();}
  menu(){if(this.active)this.finish('ABORTED','返回主選單');this.host.stop();this.unload();this.patch({...empty(),storage_error:this.state.storage_error});}
  records(){try{return this.repository.list(this.state.definition?.id);}catch{return [];}}
  update(dt:number,drone:FlightState,source:ControlSource,events:ChallengeEvent[]=[]){
    if(!Number.isFinite(dt)||dt<=0)return;
    // Caller supplies actual simulated time, capped identically to FlightModel.
    dt=Math.min(dt,.1);
    if(this.state.status==='COUNTDOWN'){const countdown=Math.max(0,this.state.countdown-dt);if(countdown<=1e-8)this.previous=structuredClone(drone);this.patch({countdown,...(countdown<=1e-8?{status:'RUNNING' as const,countdown:0,message:'挑戰開始'}:{})},countdown<=1e-8||Math.floor(countdown*10)!==Math.floor(this.state.countdown*10));return;}
    if(this.state.status!=='RUNNING'||!this.engine||!this.state.definition)return;
    const definition=this.state.definition,elapsed=this.state.elapsed+dt;
    // Idle on the pad is not a manual-control segment. Record actual active source changes.
    if(drone.mode!=='grounded'||source==='AI_MISSION'){
      if(this.history.at(-1)?.source!==source)this.history.push({source,time:this.state.elapsed});
      const category=this.history.some(h=>h.source!==source)?'MIXED':source;
      if(!definition.allowed_control_modes.includes(category)&&!definition.allowed_control_modes.includes('MIXED')){this.patch({elapsed});this.finish('FAILED','此關卡不允許目前的控制方式');return;}
    }
    const collisions=this.scene?.sample?.(drone,this.previous)??[];
    const queued=this.pendingEvents.splice(0);
    const result=this.engine.evaluate({drone:structuredClone(drone),previous:this.previous?structuredClone(this.previous):null,dt,simulation_time:elapsed,events:[...collisions,...events,...queued]});
    const t=this.trajectory,p=drone.position;if(this.previous)t.distance+=Math.hypot(p.east-this.previous.position.east,p.north-this.previous.position.north,p.up-this.previous.position.up);
    t.samples++;t.max_altitude=Math.max(t.max_altitude,p.up);t.start??={...p};t.end={...p};this.previous=structuredClone(drone);
    const control_source=this.history.length&&this.history.some(h=>h.source!==this.history[0].source)?'MIXED':this.history[0]?.source??source;
    const actualElapsed=result.completed&&!result.failed?Math.max(this.state.elapsed,Math.min(elapsed,result.completed_at??elapsed)):elapsed;
    this.patch({elapsed:actualElapsed,objectives:result.objectives,violations:result.violations,metrics:result.metrics,control_source,flight_mode:drone.controlMode},Math.floor(elapsed*10)!==Math.floor(this.state.elapsed*10));
    this.scene?.update?.(this.state);
    if(result.failed)this.finish('FAILED',result.failed);
    else if(actualElapsed>definition.time_limit+1e-8||(!result.completed&&actualElapsed>=definition.time_limit-1e-8))this.finish('FAILED','超過關卡時間限制');
    else if(result.completed)this.finish('COMPLETED','所有目標已完成');
  }
  private finish(status:'COMPLETED'|'FAILED'|'ABORTED',reason:string){
    if(terminal.has(this.state.status)||!this.state.definition||!this.attemptId)return;
    const d=this.state.definition,objectives=this.state.objectives,violations=structuredClone(this.state.violations),done=objectives.filter(o=>o.completed);
    const score=this.scoring.get(d.scoring.type).score({completion_time:this.state.elapsed,penalty_time:violations.reduce((sum,v)=>sum+v.penalty,0),completion_rate:done.length/objectives.length,precision:done.reduce((sum,o)=>sum+o.precision,0)/objectives.length,collected:done.reduce((sum,o)=>sum+o.collected,0),completed:status==='COMPLETED',violations,metrics:this.state.metrics},d.scoring.params);
    const control_source=this.history.length?this.history.every(h=>h.source===this.history[0].source)?this.history[0].source:'MIXED':'MANUAL';
    const key=courseKey(d);let previous_best:number|null=null,previousRecord:ChallengeResult|null=null;
    try{const values=this.repository.list(d.id).filter(r=>r.status==='COMPLETED'&&r.course_key===key&&r.challenge_version===d.version&&r.control_source===control_source&&r.score_unit===score.score_unit&&r.score_direction===score.score_direction);for(const r of values)if(!previousRecord||betterResult(r,previousRecord))previousRecord=r;previous_best=previousRecord?.final_score??null;}catch{}
    const is_personal_best=status==='COMPLETED'&&(!previousRecord||betterResult({...score,completion_time:this.state.elapsed},previousRecord));
    const result:ChallengeResult={...score,challenge_id:d.id,challenge_version:d.version,attempt_id:this.attemptId,status,control_source,control_history:structuredClone(this.history),completion_time:this.state.elapsed,completed_objectives:done.map(o=>o.id),violations,timestamp:this.clock().toISOString(),trajectory_summary:structuredClone(this.trajectory),seed:d.scene.seed,reason,metrics:structuredClone(this.state.metrics),course_key:key,is_personal_best,previous_best};
    let storage_error=this.state.storage_error;try{this.repository.save(result);}catch{storage_error='成績已結算，但無法寫入本機儲存（容量或權限限制）';}
    this.host.stop();this.patch({status,result,message:reason,storage_error});
  }
  dispose(){if(this.disposed)return;this.menu();this.provider=null;this.listeners.clear();this.disposed=true;}
}
