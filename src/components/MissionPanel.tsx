import { useState } from 'react';
import { MissionRunner } from '../missions/MissionRunner';
import { PRESETS as FLIGHT_PRESETS } from '../missions/presets';
import { CAMERA_PRESETS } from '../camera/presets';
const PRESETS=[...FLIGHT_PRESETS,...CAMERA_PRESETS];
import { missionSchema } from '../missions/schema';
import { LIMITS, MISSION_LIMITS as M } from '../config/limits';
import type { MissionSnapshot } from '../missions/types';
import { stepLabel } from '../missions/labels';
import { AiMissionComposer } from './AiMissionComposer';
import { parallelPreview } from '../missions/parallel';
import { DroneKitPanel } from './DroneKitPanel';
export { commandLabel, stepLabel } from '../missions/labels';
export const MISSION_STATUS = { empty:'尚未載入', ready:'準備完成', running:'執行中', paused:'已暫停', stopped:'已停止', completed:'任務完成', failed:'任務失敗' };
interface Props { runner: MissionRunner; snapshot: MissionSnapshot; onAction: (action:()=>void)=>void; onClose:()=>void; onReset?:()=>void; blocked?: boolean;publicContext?:string;aiOpen?:boolean;onAiOpen?:(value:boolean)=>void;aiPrompt?:string;onAiPrompt?:(value:string)=>void }
export function MissionPanel({ runner, snapshot, onAction, onClose, onReset, blocked=false,publicContext='',aiOpen=false,onAiOpen,aiPrompt='',onAiPrompt }: Props) {
  const [localPrompt,setLocalPrompt]=useState('');
  const [source,setSource] = useState(()=>JSON.stringify(runner.plan?.mission??PRESETS[0].mission,null,2)), [loaded,setLoaded] = useState(()=>JSON.stringify(runner.plan?.mission??PRESETS[0].mission,null,2)), [errors,setErrors] = useState<string[]>([]);
  const locked=runner.ownsControl, dirty=source!==loaded;
  const load=(text:string)=>onAction(()=>{ const result=runner.load(text);setErrors(result);if(!result.length)setLoaded(text); });
  const useAi=(text:string,start:boolean)=>{
    if(locked||blocked)return;
    setSource(text);onAction(()=>{const result=runner.load(text);setErrors(result);if(!result.length){setLoaded(text);if(start){onAiOpen?.(false);runner.start();}}});
  };
  const focusJson=()=>{onAiOpen?.(false);requestAnimationFrame(()=>{document.getElementById('mission-json')?.focus();document.getElementById('mission-json')?.scrollIntoView({block:'center',behavior:'smooth'});});};
  const downloadSchema=()=>{
    const url=URL.createObjectURL(new Blob([JSON.stringify(missionSchema,null,2)],{type:'application/schema+json'}));
    const anchor=document.createElement('a');anchor.href=url;anchor.download='ai-drone-mission-v1.2.schema.json';anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  };
  const steps=runner.plan?.steps ?? [];
  const points=runner.plan ? [runner.plan.origin,...steps.flatMap(s=>s.trajectory?parallelPreview(s.trajectory):[s.target])] : [];
  const extent=Math.max(5,...points.flatMap(p=>[Math.abs(p.east),Math.abs(p.north)]));
  return <section className="mission-panel" aria-label="自動飛行任務" id="mission-panel">
    <div className="picker-title"><div><h2>自動飛行任務</h2></div><button onClick={onClose} aria-label="關閉任務面板">✕</button></div>
    <details className="ai-section" open={aiOpen} onToggle={event=>onAiOpen?.(event.currentTarget.open)}><summary>✦ AI 中文編程 </summary><AiMissionComposer publicContext={publicContext} prompt={onAiPrompt?aiPrompt:localPrompt} onPromptChange={onAiPrompt??setLocalPrompt} disabled={locked||blocked} onUse={useAi} onEdit={focusJson}/></details>
    <div className="mission-state" role="status"><b>{MISSION_STATUS[snapshot.status]}</b><span>{snapshot.elapsed.toFixed(1)} / {M.maxDuration}s</span><p>{snapshot.message}</p></div>
    <div className="mission-buttons"><button disabled={blocked||locked||!runner.plan||dirty} onClick={()=>onAction(()=>{runner.start();})}>{snapshot.status==='completed'?'↻ 重新執行':'▶ 開始'}</button><button disabled={snapshot.status!=='running'} onClick={()=>onAction(()=>runner.pause())}>Ⅱ 暫停</button><button disabled={snapshot.status!=='paused'} onClick={()=>onAction(()=>runner.resume())}>▷ 繼續</button><button disabled={!locked} onClick={()=>onAction(()=>runner.stop())}>■ 停止</button><button onClick={()=>onReset?onReset():onAction(()=>runner.reset())}>↺ 重置任務與飛機</button></div>
    <label className="mission-label">預設任務<select disabled={locked} value={PRESETS.find(p=>JSON.stringify(p.mission)===JSON.stringify(runner.plan?.mission))?.id??'custom'} onChange={e=>{const text=JSON.stringify(PRESETS.find(p=>p.id===e.target.value)!.mission,null,2);setSource(text);load(text);}}><option value="custom" disabled>自訂任務</option>{PRESETS.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
    <label className="mission-label" htmlFor="mission-json">任務 JSON {dirty&&<small>已修改，請重新載入驗證</small>}</label>
    <textarea id="mission-json" spellCheck={false} value={source} disabled={locked} onChange={e=>setSource(e.target.value)} aria-describedby="mission-format-hint"/>
    <div className="mission-files"><button disabled={locked} onClick={()=>load(source)}>載入並驗證</button><label className={'file-button '+(locked?'disabled':'')}>匯入 JSON<input type="file" accept=".json,application/json" disabled={locked} onChange={async e=>{const file=e.target.files?.[0];e.target.value='';if(!file)return;if(file.size>M.maxSourceBytes){setErrors(['檔案最多 20KB']);return;}try{const text=await file.text();setSource(text);load(text);}catch{setErrors(['檔案讀取失敗']);}}}/></label><button onClick={downloadSchema}>下載 Schema</button></div>
    {errors.length>0&&<ul className="mission-errors" role="alert">{errors.map((error,i)=><li key={i}>{error}</li>)}</ul>}
    <DroneKitPanel source={loaded} dirty={dirty}/>
    {runner.plan?.mission.home&&<p className="mission-hint">GPS 起飛參考：{runner.plan.mission.home.latitude.toFixed(6)}, {runner.plan.mission.home.longitude.toFixed(6)}（任務設定值，未讀取裝置定位）</p>}
    {steps.some(step=>step.trajectory)&&<p className="mission-hint">平行群組是一個執行階段，所有子指令同步到達；本任務共 {runner.plan!.commandCount}／{M.maxCommands} 條指令（包含子指令）。預覽曲線為規劃路徑，實際飛行仍受風與慣性影響。</p>}
    {steps.length>0&&<><div className="mission-plan-title"><b>航點預覽・{steps.length} 步</b><span>估計 {runner.plan!.estimatedSeconds.toFixed(0)}s</span></div><svg className="mission-map" viewBox="0 0 240 150" role="img" aria-label="任務 ENU 俯視路徑預覽"><path d="M120 5V145M10 75H230" stroke="#c0cdbd"/><polyline points={points.map(p=>`${120+p.east/extent*65},${75-p.north/extent*65}`).join(' ')} fill="none" stroke="#437a65" strokeWidth="2"/>{points.map((p,i)=><circle key={i} cx={120+p.east/extent*65} cy={75-p.north/extent*65} r={i===0?4:2.5} fill={i===0?'#d99b35':'#437a65'}/>)}<text x="125" y="13">N</text><text x="222" y="70">E</text></svg><ol className="mission-steps">{steps.map((step,i)=><li key={i} className={snapshot.completed.includes(i)?'done':snapshot.index===i&&locked?'current':''}><b>{stepLabel(step)}</b><small>{snapshot.completed.includes(i)?'✓ 完成':snapshot.index===i&&locked?'目前指令':`${step.target.east.toFixed(1)}, ${step.target.north.toFixed(1)}, ${step.target.up.toFixed(1)}m・${step.speeds.horizontal}m/s`}</small></li>)}</ol></>}
    <p className="mission-hint">限高 {LIMITS.maxAltitude}m · 半徑 {LIMITS.radius}m · 速度 ≤{LIMITS.maxSpeed}m/s · 展開 ≤{M.maxCommands} 指令 · repeat ≤{M.maxRepeat} 次／{M.maxRepeatDepth} 層。暫停不計執行時間；停止後定位煞停，需落地或重置才可重跑。</p>
  </section>;
}


