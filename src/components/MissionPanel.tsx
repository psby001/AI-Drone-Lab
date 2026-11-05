import { MissionRoutePreview } from './MissionRoutePreview';
import { useEffect,useRef,useState } from 'react';
import { MissionRunner } from '../missions/MissionRunner';
import { PRESETS as FLIGHT_PRESETS } from '../missions/presets';
import { CAMERA_PRESETS } from '../camera/presets';
import { LIMITS, MISSION_LIMITS as M } from '../config/limits';
import type { Mission,MissionSnapshot } from '../missions/types';
import { AiMissionComposer } from './AiMissionComposer';
import { DroneKitPanel } from './DroneKitPanel';
import { BlocklyMissionEditor,type MissionEditorHandle } from './BlocklyMissionEditor';
import { missionToState } from '../blockly/missionBlocks';
export { commandLabel, stepLabel } from '../missions/labels';
import { MISSION_STATUS } from '../missions/status';
export { MISSION_STATUS } from '../missions/status';
const PRESETS=[...FLIGHT_PRESETS,...CAMERA_PRESETS];
interface Props { runner:MissionRunner;snapshot:MissionSnapshot;onAction:(action:()=>void)=>void;onClose:()=>void;onReset?:()=>void;blocked?:boolean;publicContext?:string;aiOpen?:boolean;onAiOpen?:(value:boolean)=>void;aiPrompt?:string;onAiPrompt?:(value:string)=>void }
export function MissionPanel({runner,snapshot,onAction,onClose,onReset,blocked=false,publicContext='',aiOpen=false,onAiOpen,aiPrompt='',onAiPrompt}:Props){
  const [localPrompt,setLocalPrompt]=useState(''),[seed,setSeed]=useState<Mission>(()=>runner.plan?.mission??PRESETS[0].mission);
  const [draft,setDraft]=useState<Mission|null>(seed),[errors,setErrors]=useState<string[]>([]),[dirty,setDirty]=useState(false);
  const editor=useRef<MissionEditorHandle>(null),locked=runner.ownsControl||blocked;
  const accept=(mission:Mission)=>{try{missionToState(mission);setSeed(structuredClone(mission));setDraft(mission);setDirty(false);setErrors([]);}catch(error){setErrors([String(error)]);}};
  useEffect(()=>{if(runner.plan&&snapshot.status==='ready')accept(runner.plan.mission);},[runner.plan]);
  const useAi=(text:string,_start:boolean)=>{if(locked)return;try{const mission=JSON.parse(text) as Mission;missionToState(mission);accept(mission);onAction(()=>{setErrors(runner.load(mission));});onAiOpen?.(false);}catch(error){setErrors([String(error)]);}};
  const execute=()=>{if(locked)return;try{const mission=editor.current!.getMission();onAction(()=>{const errors=runner.load(mission);setErrors(errors);if(!errors.length){setDraft(mission);setDirty(false);runner.start();}});}catch(error){setErrors([error instanceof Error?error.message:'積木無法執行']);}};
  return <section className="mission-panel blockly-mission-panel" aria-label="自動飛行任務" id="mission-panel">
    <div className="picker-title"><h2>積木飛行任務</h2><button onClick={onClose} aria-label="關閉任務面板">✕</button></div>
    <details className="ai-section" open={aiOpen} onToggle={event=>onAiOpen?.(event.currentTarget.open)}><summary>✦ AI 中文編程</summary><AiMissionComposer publicContext={publicContext} prompt={onAiPrompt?aiPrompt:localPrompt} onPromptChange={onAiPrompt??setLocalPrompt} disabled={locked} onUse={useAi} onEdit={()=>{onAiOpen?.(false);document.getElementById('mission-blocks')?.focus();}}/></details>
    <div className="mission-state" role="status"><b>{MISSION_STATUS[snapshot.status]}</b><span>{snapshot.elapsed.toFixed(1)} / {M.maxDuration}s</span><p>{snapshot.message}</p></div>
    <div className="mission-buttons"><button disabled={locked} onClick={execute}>▶ 執行積木</button><button disabled={snapshot.status!=='running'} onClick={()=>onAction(()=>runner.pause())}>Ⅱ 暫停</button><button disabled={snapshot.status!=='paused'} onClick={()=>onAction(()=>runner.resume())}>▷ 繼續</button><button disabled={!runner.ownsControl} onClick={()=>onAction(()=>runner.stop())}>■ 停止</button><button disabled={locked} onClick={()=>editor.current?.clear()}>清空積木</button><button onClick={()=>onReset?onReset():onAction(()=>runner.reset())}>↺ 重置任務與飛機</button></div>
    <label className="mission-label">預設任務<select disabled={locked} value="" onChange={event=>{const mission=PRESETS.find(p=>p.id===event.target.value)!.mission;accept(mission);onAction(()=>{setErrors(runner.load(mission));});}}><option value="" disabled>選擇預設積木任務</option>{PRESETS.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
    <BlocklyMissionEditor ref={editor} mission={seed} locked={locked} onChange={(mission,error)=>{setDraft(mission);setDirty(true);setErrors(error?[error]:[]);}}/>
    {errors.length>0&&<ul className="mission-errors" role="alert">{errors.map((e,i)=><li key={i}>{e}</li>)}</ul>}
    <MissionRoutePreview mission={draft} origin={runner.plan&&['running','paused','completed','stopped'].includes(snapshot.status)?runner.plan.origin:{...runner.model.state.position,up:0,heading:runner.model.state.heading}} snapshot={dirty?undefined:snapshot}/>
    {draft&&<DroneKitPanel source={draft} dirty={false}/>}<p className="mission-hint">{dirty?'積木已修改，執行前會再次驗證。 ':''}限高 {LIMITS.maxAltitude}m · 半徑 {LIMITS.radius}m · 展開最多 {M.maxCommands} 條指令。</p>
  </section>;
}
