import Ajv,{type ValidateFunction} from 'ajv';
import type { ChallengeDefinition,PluginConfig,RuleInstance,ScoreBreakdown,ScoreContext } from './types';
const ajv=new Ajv({allErrors:true,strict:false});
export interface RulePlugin {schema:object;validate?(params:Record<string,unknown>):void;create(params:Record<string,unknown>):RuleInstance}
export interface ScoringStrategy {schema:object;validate?(params:Record<string,unknown>):void;score(context:ScoreContext,params:Record<string,unknown>):ScoreBreakdown}
export class PluginRegistry<T extends {schema:object}> {
  private entries=new Map<string,{plugin:T;validate:ValidateFunction}>();
  register(type:string,plugin:T){if(this.entries.has(type))throw new Error(`重複的 plugin：${type}`);this.entries.set(type,{plugin,validate:ajv.compile(plugin.schema)});return this;}
  get(type:string){const entry=this.entries.get(type);if(!entry)throw new Error(`未註冊的 plugin：${type}`);return entry.plugin;}
  validate(config:PluginConfig){const entry=this.entries.get(config.type);if(!entry)throw new Error(`未註冊的 plugin：${config.type}`);if(!entry.validate(config.params))throw new Error(`${config.type}：${ajv.errorsText(entry.validate.errors)}`);(entry.plugin as T&{validate?:(params:Record<string,unknown>)=>void}).validate?.(config.params);}
  variants(){return [...this.entries].map(([type,{plugin}])=>({type:'object',properties:{type:{const:type},params:plugin.schema},required:['type','params']}));}
}
export class ChallengeRegistry {
  private definitions=new Map<string,ChallengeDefinition>();
  constructor(private validate:(value:unknown)=>ChallengeDefinition){}
  register(value:unknown){const definition=this.validate(value);if(this.definitions.has(definition.id))throw new Error(`重複關卡：${definition.id}`);this.definitions.set(definition.id,structuredClone(definition));return this;}
  get(id:string){const value=this.definitions.get(id);if(!value)throw new Error(`找不到關卡：${id}`);return structuredClone(value);}
  list(){return [...this.definitions.values()].map(d=>structuredClone(d));}
}
