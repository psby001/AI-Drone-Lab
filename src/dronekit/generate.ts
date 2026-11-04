import { validateMission,ORIGIN } from '../missions/validate';
import { LIMITS,MISSION_LIMITS } from '../config/limits';
import { stepLabel } from '../missions/labels';
import type { FlightCommand } from '../missions/types';
import { explainStep } from './explain';
import { isCameraCommand } from '../camera/types';
import { PYTHON_RUNTIME,TEMPLATE_SYNTAX,TEMPLATE_API } from './runtime.generated';
export { TEMPLATE_SYNTAX,TEMPLATE_API };
export interface CodeStep {index:number;label:string;sourcePath:string;line:number;implementation?:ReturnType<typeof explainStep>;target?:{east:number;north:number;up:number;heading:number}}
export interface PythonArtifact {code:string;missionCode:string;steps:CodeStep[];sha256:string}
/** Recompile at launch (ENU 0,0,0; north=0), independent of a moving simulator. */
export async function generatePython(source:unknown):Promise<PythonArtifact>{
  const {plan,errors}=validateMission(source,ORIGIN);
  if(!plan)throw new Error(errors.join('\n'));
  if(plan.steps.some(step=>isCameraCommand(step.command)))throw new Error('此任務包含網頁模擬相機指令，尚未提供對應的 DroneKit／實體相機實作，無法匯出 Python；請移除相機指令後另行驗證。');
  const payload=new TextEncoder().encode(JSON.stringify({...plan,limits:{...LIMITS,...MISSION_LIMITS}}));
  const digest=await globalThis.crypto.subtle.digest('SHA-256',payload);
  const sha256=Array.from(new Uint8Array(digest),n=>n.toString(16).padStart(2,'0')).join('');
  const b64=btoa(Array.from(payload,n=>String.fromCharCode(n)).join(''));
  const header='# AI Drone Lab — generated fixed-template ArduCopter SITL script\n# Static checks are not SITL verification or real-flight approval.\n# ENU launch origin; align to NORTH (0 degrees) after takeoff before moving.\n# Run: python mission.py --check\n# Flight: python mission.py --execute-sitl --connect tcp:127.0.0.1:5760\n';
  let code=header+'\n# 學習區：依序下達飛行指令（公尺、秒、度）\ndef run_mission(drone):\n';
  const steps:CodeStep[]=[];
  const call=(command:FlightCommand)=>`drone.${command.action}(${Object.entries(command).filter(([key,value])=>key!=='action'&&value!==undefined).map(([key,value])=>`${key}=${JSON.stringify(value)}`).join(', ')})`;
  for(const [index,step] of plan.steps.entries()){
    // Names and fields are schema-whitelisted; only validated numbers/enums become literals.
    code+=`    # ${index+1}. ${stepLabel(step)}\n`;
    const line=code.split('\n').length;
    if(step.command.action==='parallel'){
      code+=`    with drone.parallel(${step.command.reference_frame?`reference_frame="${step.command.reference_frame}"`:''}):\n`;
      for(const child of step.command.commands)code+=`        ${call(child)}\n`;
    }else if(!isCameraCommand(step.command))code+=`    ${call(step.command)}\n`;
    steps.push({index,line,label:stepLabel(step),sourcePath:step.sourcePath});
  }
  const missionCode=code;
  code+='\n\n# 以下是共用控制函式庫；初學者可先閱讀上方學習區。\n'+PYTHON_RUNTIME+`\n\nPLAN_B64 = "${b64}"\nPLAN_SHA256 = "${sha256}"\n`;
  code+='\nif __name__ == "__main__":\n    main()\n';
  for(const entry of steps){entry.implementation=explainStep(plan.steps[entry.index],code);entry.target=plan.steps[entry.index].target;}
  return{code,missionCode,steps,sha256};
}
