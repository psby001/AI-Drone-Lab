import { MISSION_LIMITS } from '../config/limits';
import * as Blockly from 'blockly';
import * as zh from 'blockly/msg/zh-hant';
import { missionSchema } from '../missions/schema';
import { validateMission } from '../missions/validate';
import type { Mission,MissionCommand } from '../missions/types';
Blockly.setLocale(Object.fromEntries(Object.entries(zh).filter((entry):entry is [string,string]=>typeof entry[1]==='string')));
type Param={type?:string;minimum?:number;maximum?:number;exclusiveMinimum?:number;exclusiveMaximum?:number;enum?:string[];const?:string};
export interface MissionBlockSpec {type:string;action:string;label:string;category:string;properties:Record<string,Param>;required:string[];frame?:string;child?:string;waypoint?:boolean}
const names:Record<string,string>={takeoff:'起飛',land:'降落',move_forward:'前進',move_backward:'後退',move_left:'左移',move_right:'右移',turn_left:'左轉',turn_right:'右轉',ascend:'上升',descend:'下降',hover:'懸停',set_speed:'設定速度',change_altitude:'飛至指定高度',set_heading:'設定航向',goto_local:'飛往本地座標',goto_gps:'飛往 GPS',follow_waypoints:'依序飛往航點',return_to_launch:'返航降落',repeat:'重複（最多4次）',parallel:'同時執行',set_camera_view:'相機視角',set_gimbal_pitch:'雲台俯仰',set_gimbal_yaw:'雲台左右',reset_gimbal:'重設雲台',capture_photo:'拍照',start_recording:'開始錄影',stop_recording:'停止錄影'};
const fields:Record<string,string>={altitude:'高度 m',distance:'距離 m',angle:'角度 °',heading:'航向 °',speed:'速度',vertical_speed:'升降速度 m/s',duration:'時間 s',x:'東 x m',y:'北 y m',z:'高 z m',latitude:'緯度',longitude:'經度',direction:'轉向方式',reference_frame:'方向參考',view:'視角',mode:'雲台模式',count:'次數'};
const options:Record<string,string>={shortest:'最短方向',left:'向左',right:'向右',body:'隨機頭',start:'群組起始方向',stabilized:'航向穩定',fpv:'機頭方向',nadir:'垂直向下',oblique:'斜向下',custom:'自訂'};
export const blockSpecs=new Map<string,MissionBlockSpec>();
export function registerMissionBlock(spec:MissionBlockSpec){
  if(blockSpecs.has(spec.type))throw new Error(`重複的積木類型：${spec.type}`);
  blockSpecs.set(spec.type,spec);
  const args:object[]=[];let text=spec.label;
  for(const [key,p]of Object.entries(spec.properties)){
    if(['action','commands','waypoints','frame'].includes(key))continue;
    if(!spec.required.includes(key)){args.push({type:'field_checkbox',name:`use_${key}`,checked:false});text+=` 設定 %${args.length}`;}
    const label=key==='speed'?(['turn_left','turn_right','set_heading'].includes(spec.action)?'轉向速度 °/s':['takeoff','ascend','descend','change_altitude'].includes(spec.action)?'升降速度 m/s':'水平速度 m/s'):fields[key]??key;
    text+=` ${label} %${args.length+1}`;
    if(p.enum)args.push({type:'field_dropdown',name:key,options:p.enum.map(v=>[options[v]??v,v])});
    else args.push({type:'field_number',name:key,value:key==='heading'||key==='latitude'||key==='longitude'||key==='x'||key==='y'?0:key==='count'?2:key==='angle'?90:key==='speed'?2:key==='duration'?1:5,min:p.minimum??(p.exclusiveMinimum!==undefined?p.exclusiveMinimum+.000001:undefined),max:p.maximum??(p.exclusiveMaximum!==undefined?p.exclusiveMaximum-.000001:undefined),precision:key==='count'?1:undefined});
  }
  const definition:Record<string,unknown>={type:spec.type,message0:text,args0:args,previousStatement:spec.waypoint?'Waypoint':'Action',nextStatement:spec.waypoint?'Waypoint':'Action',colour:spec.category==='相機與雲台'?195:spec.category==='組合動作'?285:150,tooltip:spec.label,inputsInline:false};
  if(spec.child){definition.message1='內容 %1';definition.args1=[{type:'input_statement',name:'items',check:spec.child==='waypoints'?'Waypoint':'Action'}];}
  Blockly.defineBlocksWithJsonArray([definition]);
}
// The existing Schema is the list of supported actions/parameters, not a second mission language.
for(const raw of missionSchema.definitions.command.oneOf){const v=raw as unknown as {properties:Record<string,Param>;required:string[]};const a=v.properties.action;for(const action of a.enum??[a.const!]){
  const frame=v.properties.frame?.const,type=`drone_${action}${frame?'_'+frame:''}`;
  const child=action==='repeat'||action==='parallel'?'commands':action==='follow_waypoints'?'waypoints':undefined;
  registerMissionBlock({type,action,label:names[action]??action,category:action.includes('camera')||action.includes('gimbal')||['capture_photo','start_recording','stop_recording'].includes(action)?'相機與雲台':child?'組合動作':'飛行動作',properties:v.properties,required:v.required,frame,child});
}}
for(const frame of ['local','gps'])registerMissionBlock({type:`drone_waypoint_${frame}`,action:'waypoint',label:frame==='local'?'本地航點':'GPS 航點',category:'航點',properties:frame==='local'?{x:{type:'number',minimum:-50,maximum:50},y:{type:'number',minimum:-50,maximum:50},z:{type:'number',minimum:.5,maximum:20}}:{latitude:{type:'number',minimum:-90,maximum:90},longitude:{type:'number',minimum:-180,maximum:180},altitude:{type:'number',minimum:.5,maximum:20}},required:frame==='local'?['x','y','z']:['latitude','longitude','altitude'],frame,waypoint:true});
Blockly.defineBlocksWithJsonArray([{type:'drone_mission',message0:'任務 %1 版本 %2',args0:[{type:'field_input',name:'name',text:''},{type:'field_dropdown',name:'version',options:[['1.2','1.2'],['1.1','1.1'],['1.0','1.0'],['未指定','none']]}],message1:'GPS 起飛參考 %1 緯度 %2 經度 %3',args1:[{type:'field_checkbox',name:'home',checked:false},{type:'field_number',name:'latitude',value:0,min:-90,max:90},{type:'field_number',name:'longitude',value:0,min:-180,max:180}],message2:'執行 %1',args2:[{type:'input_statement',name:'items',check:'Action'}],colour:45}]);
export const toolbox={kind:'categoryToolbox',contents:[{kind:'category',name:'任務',colour:45,contents:[{kind:'block',type:'drone_mission'}]},...['飛行動作','組合動作','航點','相機與雲台'].map(category=>({kind:'category',name:category,colour:category==='相機與雲台'?195:category==='組合動作'?285:150,contents:[...blockSpecs.values()].filter(s=>s.category===category).map(s=>({kind:'block',type:s.type}))}))]};
function chain(states:Record<string,unknown>[]){for(let i=0;i<states.length-1;i++)states[i].next={block:states[i+1]};return states[0];}
function commandState(command:Record<string,unknown>,frame?:string):Record<string,unknown>{
  const spec=[...blockSpecs.values()].find(s=>frame?s.waypoint&&s.frame===frame:!s.waypoint&&s.action===command.action&&s.frame===command.frame);if(!spec)throw new Error(`無法轉換動作：${String(command.action??frame)}`);
  const values:Record<string,unknown>={};for(const key of Object.keys(spec.properties)){if(['action','commands','waypoints','frame'].includes(key))continue;if(!spec.required.includes(key))values[`use_${key}`]=key in command?'TRUE':'FALSE';if(key in command)values[key]=command[key];}
  const state:Record<string,unknown>={type:spec.type,fields:values};if(spec.child){const children=(command[spec.child] as Record<string,unknown>[]).map(c=>commandState(c,spec.child==='waypoints'?spec.frame:undefined));if(children.length)state.inputs={items:{block:chain(children)}};}return state;
}
export function missionToState(value:unknown){
  const result=validateMission(value);if(!result.plan)throw new Error(result.errors.join('\n'));
  const mission=result.plan.mission;
  return {blocks:{languageVersion:0,blocks:[{type:'drone_mission',x:24,y:24,fields:{name:mission.name??'',version:mission.version??'none',home:mission.home?'TRUE':'FALSE',latitude:mission.home?.latitude??0,longitude:mission.home?.longitude??0},inputs:{items:{block:chain(mission.commands.map(c=>commandState(c as unknown as Record<string,unknown>)))}}}]}};
}
export function workspaceToMission(workspace:Blockly.Workspace,validate=true):Mission{
  const roots=workspace.getTopBlocks(false);if(roots.length!==1||roots[0].type!=='drone_mission')throw new Error('請保留一個任務起點，並將所有動作連接至任務內。');
  const visited=new Set<string>();
  const read=(first:Blockly.Block|null,frame?:string):Record<string,unknown>[]=>{const list:Record<string,unknown>[]=[];for(let b=first;b;b=b.getNextBlock()){
    if(visited.has(b.id)||!b.isEnabled())throw new Error('不支援循環連接或停用積木');visited.add(b.id);
    const s=blockSpecs.get(b.type);if(!s||!!frame!==!!s.waypoint||frame&&s.frame!==frame)throw new Error('積木連接類型不符');
    const command:Record<string,unknown>=s.waypoint?{}:{action:s.action};if(!s.waypoint&&s.frame)command.frame=s.frame;
    for(const [key,p]of Object.entries(s.properties)){if(['action','commands','waypoints','frame'].includes(key))continue;if(!s.required.includes(key)&&b.getFieldValue(`use_${key}`)!=='TRUE')continue;command[key]=p.enum?b.getFieldValue(key):Number(b.getFieldValue(key));}
    if(s.child)command[s.child]=read(b.getInputTargetBlock('items'),s.child==='waypoints'?s.frame:undefined);list.push(command);
  }return list;};
  const root=roots[0];if(!root.isEnabled())throw new Error('任務起點不能停用');visited.add(root.id);
  const mission:Mission={commands:read(root.getInputTargetBlock('items')) as unknown as MissionCommand[]};const name=root.getFieldValue('name'),version=root.getFieldValue('version');if(name)mission.name=name;if(version!=='none')mission.version=version;if(root.getFieldValue('home')==='TRUE')mission.home={latitude:Number(root.getFieldValue('latitude')),longitude:Number(root.getFieldValue('longitude'))};
  if(visited.size!==workspace.getAllBlocks(false).length)throw new Error('有未連接或無法轉換的積木');
  if(validate){const result=validateMission(mission);if(!result.plan)throw new Error(result.errors.join('\n'));}return mission;
}
export function savedWorkspace(workspace:Blockly.Workspace){return{format:'ai-drone-blockly',version:1,workspace:Blockly.serialization.workspaces.save(workspace)};}
export function readSavedWorkspace(source:string):object{
  if(source.length>200000)throw new Error('積木檔案過大');const envelope=JSON.parse(source);if(envelope?.format!=='ai-drone-blockly'||envelope.version!==1||!envelope.workspace||Object.keys(envelope.workspace).some(k=>k!=='blocks'))throw new Error('請載入本平台的積木工作區檔案');
  let nodes=0;const visit=(v:unknown,depth:number)=>{if(++nodes>5000||depth>100)throw new Error('積木資料過大或過深');if(v&&typeof v==='object'){const o=v as Record<string,unknown>;if('type'in o&&(typeof o.type!=='string'||o.type!=='drone_mission'&&!blockSpecs.has(o.type)))throw new Error('工作區含未支援積木');if(typeof o.type==='string'){
      const spec=blockSpecs.get(o.type),inputFields=(o.fields??{}) as Record<string,unknown>;
      const allowed=o.type==='drone_mission'?['name','version','home','latitude','longitude']:[...Object.keys(spec!.properties).filter(k=>!['action','commands','waypoints','frame'].includes(k)),...Object.keys(spec!.properties).filter(k=>!spec!.required.includes(k)).map(k=>'use_'+k)];
      for(const [key,value]of Object.entries(inputFields)){
        if(!allowed.includes(key))throw new Error('工作區含未知參數');
        const p=spec?.properties[key]??(['latitude','longitude'].includes(key)?{type:'number',minimum:key==='latitude'?-90:-180,maximum:key==='latitude'?90:180}:undefined);
        if(p?.type==='number'||p?.type==='integer'){if(typeof value!=='number'||!Number.isFinite(value)||p.type==='integer'&&!Number.isInteger(value)||value<(p.minimum??-Infinity)||value>(p.maximum??Infinity)||p.exclusiveMinimum!==undefined&&value<=p.exclusiveMinimum||p.exclusiveMaximum!==undefined&&value>=p.exclusiveMaximum)throw new Error('工作區數值超出範圍');}
        if(p?.enum&&!p.enum.includes(value as string))throw new Error('工作區選項不合法');
        if((key.startsWith('use_')||key==='home')&&![true,false,'TRUE','FALSE'].includes(value as boolean))throw new Error('工作區設定開關不合法');
        if(key==='version'&&!['none','1.0','1.1','1.2'].includes(value as string))throw new Error('工作區任務版本不合法');
        if(key==='name'&&(typeof value!=='string'||value.length>80))throw new Error('任務名稱過長');
      }
      if(o.inputs&&Object.keys(o.inputs as object).some(k=>k!=='items'))throw new Error('工作區包含不支援的連接');
    }
    if('extraState'in o||'data'in o)throw new Error('工作區包含不支援的額外資料');Object.values(o).forEach(c=>visit(c,depth+1));}};visit(envelope.workspace,0);
  // Deserialize into a temporary workspace first, so a failed load never clears a student's work.
  const temp=new Blockly.Workspace();try{Blockly.serialization.workspaces.load(envelope.workspace,temp);if(temp.getAllBlocks(false).length>MISSION_LIMITS.maxCommands*2+1)throw new Error('積木數量過多');return Blockly.serialization.workspaces.save(temp);}finally{temp.dispose();}
}
