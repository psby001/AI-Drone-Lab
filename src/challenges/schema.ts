import Ajv from 'ajv';
import type { ChallengeDefinition } from './types';
import type { PluginRegistry,RulePlugin,ScoringStrategy } from './registry';
const num=(minimum:number,maximum:number)=>({type:'number',minimum,maximum});
const vec={type:'object',additionalProperties:false,required:['east','north','up'],properties:{east:num(-50,50),north:num(-50,50),up:num(0,20)}};
const plugin={type:'object',required:['type','params'],properties:{type:{type:'string',minLength:1,maxLength:80},params:{type:'object'}}};
const objective={...plugin,additionalProperties:false,required:['type','params','id','title','order'],properties:{...plugin.properties,id:{type:'string',minLength:1,maxLength:80},title:{type:'string',maxLength:120},order:{type:'integer',minimum:0,maximum:100}}};
export const challengeSchema={
  $schema:'http://json-schema.org/draft-07/schema#',title:'AI Drone Lab ChallengeDefinition',type:'object',additionalProperties:false,
  required:['id','version','title','description','difficulty','thumbnail','scene','spawn','objectives','rules','scoring','allowed_control_modes','time_limit','metadata'],
  properties:{
    id:{type:'string',pattern:'^[a-z0-9-]{1,80}$'},version:{type:'string',pattern:'^\\d+\\.\\d+\\.\\d+$'},title:{type:'string',minLength:1,maxLength:120},description:{type:'string',maxLength:2000},difficulty:{enum:['beginner','intermediate','advanced']},thumbnail:{type:'string',maxLength:500},
    scene:{...plugin,additionalProperties:false,required:['type','params','seed','objects','environment'],properties:{...plugin.properties,seed:{type:'integer',minimum:0,maximum:4294967295},environment:{type:'object',additionalProperties:false,required:['wind','direction'],properties:{wind:{enum:['calm','breeze','strong']},direction:num(0,360)}},objects:{type:'array',maxItems:200,items:{type:'object',additionalProperties:false,required:['id','kind','position','size','color','solid'],properties:{id:{type:'string',minLength:1,maxLength:80},kind:{enum:['building','obstacle','platform','waypoint','zone','target']},position:vec,size:{...vec,properties:{east:num(.01,100),north:num(.01,100),up:num(.01,40)}},color:{type:'string',pattern:'^#[0-9a-fA-F]{6}$'},solid:{type:'boolean'}}}}}},
    spawn:{type:'object',additionalProperties:false,required:['position','heading'],properties:{position:{...vec,properties:{...vec.properties,up:{const:0}}},heading:num(0,360)}},
    objectives:{type:'array',minItems:1,maxItems:50,items:objective},rules:{type:'array',maxItems:50,items:{...plugin,additionalProperties:false,required:['id','type','params'],properties:{...plugin.properties,id:{type:'string',minLength:1,maxLength:80}}}},scoring:{...plugin,additionalProperties:false},allowed_control_modes:{type:'array',minItems:1,uniqueItems:true,items:{enum:['MANUAL','AI_MISSION','MIXED']}},time_limit:num(1,3600),metadata:{type:'object'},
  },
};
/** Emit the exact registered plugin schemas, including dedicated params, for external tooling. */
export function buildChallengeSchema(rules:PluginRegistry<RulePlugin>,scoring:PluginRegistry<ScoringStrategy>,scenes:PluginRegistry<{schema:object}>){
  const extend=(base:object,registry:PluginRegistry<{schema:object}>)=>({...base,allOf:[{oneOf:registry.variants()}]});
  return {...challengeSchema,properties:{...challengeSchema.properties,scene:extend(challengeSchema.properties.scene,scenes),objectives:{...challengeSchema.properties.objectives,items:extend(objective,rules)},rules:{...challengeSchema.properties.rules,items:extend(challengeSchema.properties.rules.items,rules)},scoring:extend(challengeSchema.properties.scoring,scoring)}};
}
export function definitionValidator(rules:PluginRegistry<RulePlugin>,scoring:PluginRegistry<ScoringStrategy>,scenes:PluginRegistry<{schema:object;validateDefinition?:(definition:ChallengeDefinition)=>void}>){
  // Resolve plugin validation at registration time so later plugin registration also works.
  const ajv=new Ajv({allErrors:true,strict:false}),validate=ajv.compile(challengeSchema);
  return(value:unknown):ChallengeDefinition=>{
    if(!validate(value))throw new Error(`關卡格式錯誤：${ajv.errorsText(validate.errors)}`);
    const d=value as unknown as ChallengeDefinition;
    scenes.validate(d.scene);scoring.validate(d.scoring);for(const rule of [...d.rules,...d.objectives])rules.validate(rule);
    scenes.get(d.scene.type).validateDefinition?.(d);
    for(const list of [d.objectives,d.rules,d.scene.objects])if(new Set(list.map(o=>o.id)).size!==list.length)throw new Error('關卡物件／規則 id 不可重複');
    if(Math.hypot(d.spawn.position.east,d.spawn.position.north)>45)throw new Error('出生點須在半徑 45m 內');
    return structuredClone(d);
  };
}
