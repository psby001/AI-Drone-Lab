import { PluginRegistry,type ScoringStrategy } from './registry';
export function createScoringRegistry(){return new PluginRegistry<ScoringStrategy>()
  .register('points',{schema:{type:'object',additionalProperties:false,required:['completion','precision','collection','time_bonus','multiplier'],properties:{completion:{type:'number',minimum:0,maximum:100000},precision:{type:'number',minimum:0,maximum:100000},collection:{type:'number',minimum:0,maximum:100000},time_bonus:{type:'number',minimum:0,maximum:10000},multiplier:{type:'number',minimum:.1,maximum:10}}},score:(c,p)=>{
    const bonuses=[{label:'精準度',value:c.precision*Number(p.precision)},{label:'收集數量',value:c.collected*Number(p.collection)},{label:'完成時間加成',value:c.completed?Math.max(0,Number(p.time_bonus)-c.completion_time):0}];
    const penalties=c.violations.map(v=>({label:v.message,value:v.penalty}));
    const lines=[{label:'目標完成率',value:c.completion_rate*Number(p.completion)},...bonuses,...penalties.map(p=>({...p,value:-p.value}))];
    const total=lines.reduce((a,b)=>a+b.value,0);lines.push({label:`倍率 ×${p.multiplier}`,value:total*(Number(p.multiplier)-1)});
    return{final_score:Math.round(Math.max(0,total*Number(p.multiplier))*100)/100,score_unit:'分',score_direction:'higher',bonuses,penalties,lines};
  }})
  .register('elapsed-time',{schema:{type:'object',additionalProperties:false,required:[],properties:{}},score:c=>({final_score:Math.round((c.completion_time+c.penalty_time)*100)/100,score_unit:'秒',score_direction:'lower',bonuses:[],penalties:c.violations.map(v=>({label:v.message,value:v.penalty})),lines:[{label:'實際時間',value:c.completion_time},{label:'懲罰時間',value:c.penalty_time}]})});}
