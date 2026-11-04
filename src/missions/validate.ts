import Ajv from 'ajv';
import { bodyToWorld, normalizeHeading } from '../core/coordinates';
import { LIMITS, MISSION_LIMITS as M } from '../config/limits';
import { missionSchema } from './schema';
import type { Mission, MissionCommand, MissionPlan, MissionPose, MissionStep, FlightCommand, LocalWaypoint, GpsWaypoint,ExecutableCommand,ParallelTrajectory } from './types';
import { gpsToLocal } from './geodesy';
import { compileParallel,parallelBounds } from './parallel';
import { isCameraCommand,CAMERA_LIMITS } from '../camera/types';
const checkSchema = new Ajv({ allErrors: true, strict: false }).compile(missionSchema);
export const ORIGIN: MissionPose = { east: 0, north: 0, up: 0, heading: 0 };
export function validateMission(source: string | unknown, origin: MissionPose = ORIGIN): { plan?: MissionPlan; errors: string[] } {
  const errors: string[] = [];
  let data: unknown = source;
  if (typeof source === 'string') {
    if (new TextEncoder().encode(source).length > M.maxSourceBytes) return { errors: ['JSON 過大，最多 20KB。'] };
    try { data = JSON.parse(source); } catch { return { errors: ['JSON 語法錯誤，請檢查逗號、引號與括號。'] }; }
  }
  // Bound depth/count before a recursive schema validator visits untrusted input.
  let nodes = 0;
  const guard = (value: unknown, depth: number): boolean => {
    if (++nodes > M.maxJsonNodes || depth > M.maxJsonDepth) return false;
    if (value && typeof value === 'object') return Object.values(value).every(item => guard(item, depth + 1));
    return typeof value !== 'number' || Number.isFinite(value);
  };
  if (!guard(data, 0)) return { errors: ['任務過深、過大，或包含非有限數值。'] };
  if (!checkSchema(data)) {
    const messages = (checkSchema.errors??[]).flatMap(error=>{
      const limit=error.params.limit;
      const descriptions:Record<string,string>={maximum:`不得大於 ${limit}`,minimum:`不得小於 ${limit}`,exclusiveMinimum:`必須大於 ${limit}`,exclusiveMaximum:`必須小於 ${limit}`,maxItems:`最多 ${limit} 項`,minItems:`至少 ${limit} 項`,maxLength:`最長 ${limit} 字`,minLength:`至少 ${limit} 字`,type:`必須是 ${error.params.type}`};
      return descriptions[error.keyword]?[`${error.instancePath||'/'}：${descriptions[error.keyword]}`]:[];
    });
    return { errors: messages.length ? [...new Set(messages)].slice(0,4) : ['格式不符：請檢查 action、必要參數、版本，並移除不支援的欄位。'] };
  }
  if (!Object.values(origin).every(Number.isFinite) || Math.abs(origin.up) > 0.01) return { errors: ['任務必須從地面開始。'] };
  const mission = structuredClone(data) as unknown as Mission;
  type Expanded = Exclude<MissionCommand,{action:'repeat'}>;
  const items: {command:Expanded;path:string}[]=[];
  const flatten=(commands:MissionCommand[],depth:number,path:string)=>{
    for(let i=0;i<commands.length&&!errors.length;i++){
      const command=commands[i],sourcePath=`${path}/${i}`;
      if(command.action==='repeat'){
        if(depth>=M.maxRepeatDepth){errors.push(`repeat 最多巢狀 ${M.maxRepeatDepth} 層。`);return;}
        for(let n=0;n<command.count&&!errors.length;n++)flatten(command.commands,depth+1,`${sourcePath}/commands[${n+1}]`);
      }else{items.push({command,path:sourcePath});if(items.length>M.maxCommands)errors.push(`展開後最多 ${M.maxCommands} 條指令。`);}
    }
  };
  flatten(mission.commands,0,'/commands');
  if(errors.length)return{errors};
  const legacy=new Set(['takeoff','land','move_forward','move_backward','move_left','move_right','turn_left','turn_right','ascend','descend','hover']);
  if(mission.version&&mission.version!=='1.2'&&items.some(item=>isCameraCommand(item.command)))return{errors:['相機指令請使用 version: "1.2"，或省略版本。']};
  if(mission.version&&mission.version!=='1.2'&&items.some(item=>item.command.action==='parallel'))return{errors:['parallel 請使用 version: "1.2"，或省略版本。']};
  if(mission.version==='1.0'&&(mission.home||items.some(item=>!legacy.has(item.command.action))))return{errors:['新指令與 GPS home 請使用 version: "1.1"，或省略版本。舊版 1.0 任務仍相容。']};
  const flightItems=items.filter(item=>!isCameraCommand(item.command));
  if(flightItems.find(item=>item.command.action!=='set_speed')?.command.action!=='takeoff'||!['land','return_to_launch'].includes(flightItems.at(-1)?.command.action??''))return{errors:['第一個飛行指令必須為 takeoff（前面可先 set_speed）；最後飛行指令必須為 land 或 return_to_launch。']};
  const target={...origin},steps:MissionStep[]=[];
  let estimatedSeconds=0,commandCount=0,horizontalSpeed:number=M.defaultSpeed,verticalSpeed:number=M.defaultVerticalSpeed,airborne=false,landed=false;
  let recording=false,recordingAt=0;
  const append=(command:ExecutableCommand,path:string,label?:string)=>{
    if(errors.length)return;
    commandCount+=command.action==='parallel'?command.commands.length:1;
    if(commandCount>M.maxCommands){errors.push(`航點／返航／repeat／parallel 子指令展開後最多 ${M.maxCommands} 條指令。`);return;}
    const before={...target};
    let trajectory:ParallelTrajectory|undefined,parallelSpeeds:MissionStep['speeds']|undefined;
    if(landed&&!isCameraCommand(command)){errors.push('降落／返航落地後不可再加入飛行指令。');return;}
    if(isCameraCommand(command)){
      if(command.action==='start_recording'){if(recording){errors.push('不可重複 start_recording。');return;}recording=true;recordingAt=estimatedSeconds;}
      if(command.action==='stop_recording'){if(!recording){errors.push('stop_recording 前必須先 start_recording。');return;}if(estimatedSeconds-recordingAt>CAMERA_LIMITS.maxRecordingSeconds){errors.push('單段錄影估計不得超過 120 秒。');return;}recording=false;}
    }else if(command.action==='set_speed'){
      horizontalSpeed=command.speed;verticalSpeed=command.vertical_speed??verticalSpeed;
    }else if(command.action==='takeoff'){
      if(airborne){errors.push('任務只能起飛一次。');return;}
      airborne=true;target.up=command.altitude;
    }else{
      if(!airborne){errors.push(`${path}：必須先 takeoff。`);return;}
      switch(command.action){
        case 'parallel':{
          try{const compiled=compileParallel(command,before,{horizontal:horizontalSpeed,vertical:verticalSpeed,yaw:M.defaultYawSpeed});trajectory=compiled.trajectory;parallelSpeeds=compiled.speeds;Object.assign(target,compiled.target);}
          catch(error){errors.push(`${path}：${(error as Error).message}`);return;}break;
        }
        case 'land':target.up=0;airborne=false;landed=true;break;
        case 'change_altitude':target.up=command.altitude;break;
        case 'ascend':target.up+=command.distance;break;
        case 'descend':target.up-=command.distance;break;
        case 'turn_left':target.heading-=command.angle;break;
        case 'turn_right':target.heading+=command.angle;break;
        case 'set_heading':{
          const current=normalizeHeading(target.heading);
          let delta=((command.heading-current+540)%360)-180;
          if(delta===-180)delta=180;
          if(command.direction==='right')delta=(command.heading-current+360)%360;
          if(command.direction==='left')delta=-((current-command.heading+360)%360);
          target.heading+=delta;break;
        }
        case 'goto_local':target.east=origin.east+command.x;target.north=origin.north+command.y;target.up=command.z;break;
        case 'goto_gps':{
          if(!mission.home){errors.push(`${path}：goto_gps 必須提供任務 home.latitude／longitude。`);return;}
          try{const local=gpsToLocal(command,mission.home);target.east=origin.east+local.east;target.north=origin.north+local.north;target.up=command.altitude;}
          catch(error){errors.push(`${path}：${(error as Error).message}`);return;}break;
        }
        case 'hover':break;
        default:{
          const f=command.action==='move_forward'?command.distance:command.action==='move_backward'?-command.distance:0;
          const r=command.action==='move_right'?command.distance:command.action==='move_left'?-command.distance:0;
          const movement=bodyToWorld(f,r,target.heading);target.east+=movement.east;target.north+=movement.north;
        }
      }
    }
    const speed='speed'in command?command.speed:undefined;
    const horizontal=parallelSpeeds?.horizontal??(['move_forward','move_backward','move_left','move_right','goto_local','goto_gps'].includes(command.action)?speed??horizontalSpeed:horizontalSpeed);
    const vertical=parallelSpeeds?.vertical??(['takeoff','ascend','descend','change_altitude'].includes(command.action)?speed??verticalSpeed:verticalSpeed);
    const yaw=parallelSpeeds?.yaw??(['turn_left','turn_right','set_heading'].includes(command.action)?speed??M.defaultYawSpeed:M.defaultYawSpeed);
    let duration=0;
    if(isCameraCommand(command))duration=command.action==='capture_photo'||command.action==='stop_recording'?2:0.1;
    else if(command.action!=='set_speed'){
      duration=Math.max(Math.hypot(target.east-before.east,target.north-before.north)/horizontal,Math.abs(target.up-before.up)/vertical)+Math.abs(target.heading-before.heading)/yaw+M.settleTime+2;
      if(command.action==='hover')duration+=command.duration;
      if(command.action==='land')duration=before.up/1.2+5+M.settleTime;
      if(trajectory)duration=trajectory.duration+M.settleTime+2;
    }
    if(duration>M.commandTimeout)errors.push(`${path}：估計耗時超過單步 ${M.commandTimeout} 秒。`);
    estimatedSeconds+=duration;
    if((trajectory?parallelBounds(trajectory,origin):[target]).some(point=>Math.hypot(point.east-origin.east,point.north-origin.north)>LIMITS.radius+1e-8||Math.hypot(point.east,point.north)>LIMITS.radius+1e-8))errors.push(`${path}：路徑超出水平半徑 ${LIMITS.radius}m。`);
    if(target.up>LIMITS.maxAltitude||(airborne&&target.up<M.minAltitude))errors.push(`${path}：飛行高度須介於 ${M.minAltitude}–${LIMITS.maxAltitude}m；接地請使用 land。`);
    steps.push({command,sourcePath:path,target:{...target},speeds:{horizontal,vertical,yaw},...(trajectory?{trajectory}:{}),...(label?{label}:{})});
  };
  for(const [index,{command,path}] of items.entries()){
    if(errors.length)break;
    if(command.action==='return_to_launch'){
      if(items.slice(index+1).some(item=>!isCameraCommand(item.command))||!airborne){errors.push('return_to_launch 必須在起飛後且為最後飛行指令，會自動落地，不需再接 land。');break;}
      const safeAltitude=Math.max(target.up,command.altitude??M.rtlAltitude);
      const stages:FlightCommand[]=[{action:'change_altitude',altitude:safeAltitude},{action:'goto_local',x:0,y:0,z:safeAltitude,...(command.speed!==undefined?{speed:command.speed}:{})},{action:'set_heading',heading:normalizeHeading(origin.heading)},{action:'change_altitude',altitude:Math.min(safeAltitude,M.rtlApproachAltitude)},{action:'hover',duration:M.rtlHoverDuration},{action:'land'}];
      const labels=['安全高度','返回起飛點','恢復起飛航向','下降至進場高度','返航懸停確認','降落並 Disarm'];
      stages.forEach((stage,i)=>append(stage,`${path}/rtl/${i}`,`返航 ${i+1}/6：${labels[i]}`));
    }else if(command.action==='follow_waypoints'){
      command.waypoints.forEach((point,i)=>{
        const stage:FlightCommand=command.frame==='local'?{action:'goto_local',...(point as LocalWaypoint),...(command.speed!==undefined?{speed:command.speed}:{})}:{action:'goto_gps',...(point as GpsWaypoint),...(command.speed!==undefined?{speed:command.speed}:{})};
        append(stage,`${path}/waypoints/${i}`,`航點 ${i+1}/${command.waypoints.length}`);
      });
    }else append(command,path);
  }
  if(recording)errors.push('任務錄影必須以 stop_recording 結束。');
  if(estimatedSeconds>M.maxDuration)errors.push(`估計任務時間超過 ${M.maxDuration} 秒，請縮短路徑或調整速度。`);
  return errors.length?{errors}:{errors,plan:{mission,origin:{...origin},steps,estimatedSeconds,commandCount}};
}
