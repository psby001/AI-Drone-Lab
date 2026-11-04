import { SCENE_LIMITS } from '../config/limits';
import type { ChallengeDefinition,ChallengeSceneHandle,ChallengeSceneProvider } from '../challenges/types';
import type { SceneFactory } from '../challenges/scene';
import { PluginRegistry } from '../challenges/registry';
import type { Vec3 } from '../core/coordinates';
import type { EnvironmentSettings } from '../core/environment';

export interface FreeSceneDefinition {
  id:string;title:string;description:string;category:string;thumbnail:string;
  spawn_position:Vec3;spawn_heading:number;initial_camera_pose:Vec3;
  flight_bounds:{radius:number};max_altitude:number;environment_settings:EnvironmentSettings;
  scene:ChallengeDefinition['scene'];
}
export function asSceneDefinition(d:FreeSceneDefinition):ChallengeDefinition{return{id:d.id,version:'1.0',title:d.title,description:d.description,difficulty:'beginner',thumbnail:d.thumbnail,scene:d.scene,spawn:{position:d.spawn_position,heading:d.spawn_heading},objectives:[],rules:[],scoring:{type:'none',params:{}},allowed_control_modes:['MANUAL','AI_MISSION','MIXED'],time_limit:180,metadata:{freeFlight:true}};}
export class FreeSceneRegistry {
  readonly factories=new PluginRegistry<SceneFactory>();private entries=new Map<string,FreeSceneDefinition>();
  registerScene(d:FreeSceneDefinition){
    if(!d.id||this.entries.has(d.id))throw new Error('場景 ID 重複或空白');
    if(!(d.flight_bounds.radius>0&&d.flight_bounds.radius<=SCENE_LIMITS.maxRadius&&d.max_altitude>=.5&&d.max_altitude<=SCENE_LIMITS.maxAltitude)||!Object.values(d.spawn_position).every(Number.isFinite)||d.spawn_position.up!==0||Math.hypot(d.spawn_position.east,d.spawn_position.north)>=d.flight_bounds.radius||!Number.isFinite(d.spawn_heading)||!Object.values(d.initial_camera_pose).every(Number.isFinite))throw new Error('場景出生點或邊界不合法');
    this.factories.validate(d.scene);this.factories.get(d.scene.type).validateDefinition?.(asSceneDefinition(d));this.entries.set(d.id,structuredClone(d));return this;
  }
  unregisterScene(id:string){this.entries.delete(id);}
  listScenes(){return [...this.entries.values()].map(d=>structuredClone(d));}
  get(id:string){const d=this.entries.get(id);if(!d)throw new Error('場景不存在');return structuredClone(d);}
}
export type FreeSceneStatus='UNLOADED'|'LOADING'|'READY'|'ACTIVE'|'UNLOADING'|'ERROR';
export interface FreeSceneSnapshot {status:FreeSceneStatus;active:FreeSceneDefinition|null;requested:string|null;error:string;paused:boolean}
export class FreeSceneManager {
  private state:FreeSceneSnapshot={status:'UNLOADED',active:null,requested:null,error:'',paused:false};
  private listeners=new Set<()=>void>();private abort:AbortController|null=null;private handle:ChallengeSceneHandle|null=null;private generation=0;
  constructor(readonly registry:FreeSceneRegistry,private provider:ChallengeSceneProvider,private hooks:{before:()=>void;initialize:(d:FreeSceneDefinition)=>void}){}
  getSnapshot=()=>this.state;
  subscribe=(fn:()=>void)=>{this.listeners.add(fn);return()=>{this.listeners.delete(fn);};};
  private patch(p:Partial<FreeSceneSnapshot>){this.state={...this.state,...p};this.listeners.forEach(f=>f());}
  getActiveScene(){return this.state.active;}
  listScenes(){return this.registry.listScenes();}
  async loadScene(id:string){return this.switchScene(id);}
  async switchScene(id:string):Promise<boolean>{
    const d=this.registry.get(id),previous=this.state.active,version=++this.generation;
    this.abort?.abort();const controller=new AbortController();this.abort=controller;
    this.hooks.before();this.patch({status:'UNLOADING',requested:id,error:'',paused:true});this.handle?.dispose();this.handle=null;
    this.patch({status:'LOADING'});
    try{
      const handle=await this.provider.load(asSceneDefinition(d),controller.signal);
      if(version!==this.generation||controller.signal.aborted){handle.dispose();return false;}
      this.handle=handle;this.patch({status:'READY'});this.hooks.initialize(d);this.patch({status:'ACTIVE',active:d,requested:null,paused:false});return true;
    }catch(error){
      if(version!==this.generation||controller.signal.aborted)return false;
      this.handle?.dispose();this.handle=null;
      const message=error instanceof Error?error.message:'場景載入失敗';
      // Restore the previous safe scene, without hiding the original error.
      if(previous){try{const handle=await this.provider.load(asSceneDefinition(previous),controller.signal);if(version!==this.generation){handle.dispose();return false;}this.handle=handle;this.hooks.initialize(previous);this.patch({status:'ACTIVE',active:previous,requested:null,error:message,paused:false});return false;}catch{}}
      if(version===this.generation)this.patch({status:'ERROR',active:null,requested:null,error:message,paused:true});return false;
    }
  }
  pause(){this.patch({paused:true});}
  resume(){if(this.state.active)this.patch({paused:false});}
  sample(current:Parameters<NonNullable<ChallengeSceneHandle['sample']>>[0],previous:Parameters<NonNullable<ChallengeSceneHandle['sample']>>[1]){return this.handle?.sample?.(current,previous)??[];}
  unloadScene(){this.generation++;this.abort?.abort();this.hooks.before();this.patch({status:'UNLOADING'});this.handle?.dispose();this.handle=null;this.patch({status:'UNLOADED',active:null,requested:null,paused:true});}
  dispose(){this.generation++;this.abort?.abort();this.handle?.dispose();this.handle=null;this.listeners.clear();}
}
