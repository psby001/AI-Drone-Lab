import type { MissionStep } from '../missions/types';
export interface ImplementationSnippet {title:string;line:number;code:string;name:string}
/** Read definitions from the exact downloadable script, never a second teaching template. */
export function pythonDefinition(code:string,owner:string|null,name:string):{line:number;code:string}{
  const lines=code.split('\n');
  const scope=owner?lines.findIndex(line=>line===`class ${owner}:`):0;
  if(scope<0)throw new Error(`Missing Python class: ${owner}`);
  const scopeEnd=owner?lines.findIndex((line,i)=>i>scope&&line.trim()&&!/^\s/.test(line)):-1;
  const prefix=owner?'    ':'';
  let start=lines.findIndex((line,i)=>i>=scope&&(scopeEnd<0||i<scopeEnd)&&line.startsWith(`${prefix}def ${name}(`));
  if(start<0)throw new Error(`Missing Python implementation: ${owner??''}.${name}`);
  let end=start+1;
  while(end<lines.length){const line=lines[end];if(line.trim()&&line.length-line.trimStart().length<=prefix.length)break;end++;}
  if(start>0&&lines[start-1].startsWith(prefix+'@'))start--;
  return{line:start+1,code:lines.slice(start,end).join('\n').trimEnd()};
}
export function explainStep(step:MissionStep,code:string){
  const action=step.command.action;
  const snippets:ImplementationSnippet[]=[];
  const add=(owner:string|null,name:string,title:string)=>{if(snippets.some(s=>s.name===`${owner??''}.${name}`))return;snippets.push({...pythonDefinition(code,owner,name),title,name:`${owner??''}.${name}`});};
  add('FlightCommands',action,'1. 教學指令的實際函式');
  if(action==='parallel')for(const command of step.command.commands)add('FlightCommands',command.action,`平行子指令：${command.action}`);
  add('FlightCommands','_command','2. 核對參數與任務順序');
  add('DroneController','execute_step','3. 分派至實際控制流程');
  let explanation:string;
  if(action==='takeoff'){
    explanation='先確認定位與解鎖條件、切換 GUIDED，再設定爬升速度、Arm，呼叫 DroneKit simple_takeoff()；等待高度到達後才繼續。';
    add('DroneController','prepare','飛行前檢查與 VehicleMode("GUIDED")');
    add('DroneController','takeoff','4. Arm 與 simple_takeoff()');
    add('DroneController','capture_launch','解鎖後等待本地座標並記錄起飛點');
  }else if(action==='land'){
    explanation='DroneKit 將模式設為 LAND，由 ArduPilot 執行下降及落地自動 Disarm；程式持續等待確認，不會在空中強制停槳。';
    add('DroneController','land','4. VehicleMode("LAND") 與落地確認');
  }else if(action==='set_speed'){
    explanation='groundspeed 設定透過 DroneKit 傳送；後續各步的水平／垂直速度也已由共用任務編譯器解析，track() 使用這些速度計算平滑航段時間。';
    add('DroneController','track','4. 後續航段如何使用速度');
  }else if(action==='hover'){
    explanation='懸停會在指定秒數內持續送出相同位置與航向目標，速度設為零；不是只讓 Python sleep 而不下飛行指令。';
    add('DroneController','hover','4. 持續發送懸停目標');
  }else{
    explanation='DroneKit 沒有原生 move_forward()。本平台先將任務距離與航向轉成 ENU 目標，再由 track() 產生平滑位置／速度。send_target() 轉為 NED，建立 SET_POSITION_TARGET_LOCAL_NED 並用 send_mavlink() 送給 ArduPilot。';
    add('DroneController','track','4. 依目標、速度與航向產生航段');
    add(null,'sample','5. 依時間取樣位置與速度');
    add(null,'trajectory_pose','6. 計算直線或機體方向弧線的位置');
  }
  if(action!=='land'){
    add('DroneController','send_target','實際送往飛控：建立 MAVLink 訊息並 send_mavlink()');
    if(action!=='set_speed'){
      add('DroneController','settle','等待位置與航向穩定');
      add('DroneController','reached','如何確認已到達目標');
    }
  }
  add('DroneController','guard','持續檢查逾時、心跳、模式與飛行邊界');
  if(action==='takeoff'||action==='land'){
    add('DroneController','change_mode','確認模式切換，有限時間重送');
    add(null,'request_copter_mode','透過 SET_MODE 訊息設定 GUIDED／LAND');
  }
  return{explanation,snippets};
}
