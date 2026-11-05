import { MISSION_LIMITS } from '../config/limits';
import { forwardRef,useEffect,useImperativeHandle,useRef,useState } from 'react';
import * as Blockly from 'blockly';
import { missionToState,workspaceToMission,savedWorkspace,readSavedWorkspace,toolbox } from '../blockly/missionBlocks';
import type { Mission } from '../missions/types';
export interface MissionEditorHandle {getMission():Mission;clear():void}
export const BlocklyMissionEditor=forwardRef<MissionEditorHandle,{mission:Mission;locked:boolean;onChange:(mission:Mission|null,error:string)=>void}>(function Editor({mission,locked,onChange},ref){
  const host=useRef<HTMLDivElement>(null),workspace=useRef<Blockly.WorkspaceSvg|null>(null),change=useRef(onChange),lockedRef=useRef(locked);
  change.current=onChange;lockedRef.current=locked;
  const [notice,setNotice]=useState('');
  const report=()=>{try{change.current(workspaceToMission(workspace.current!), '');}catch(error){change.current(null,error instanceof Error?error.message:'積木無法轉換');}};
  useImperativeHandle(ref,()=>({getMission:()=>workspaceToMission(workspace.current!),clear:()=>{if(lockedRef.current)return;workspace.current?.clear();report();}}),[]);
  useEffect(()=>{
    const w=Blockly.inject(host.current!,{toolbox,media:'/blockly-media/',renderer:'zelos',trashcan:true,scrollbars:true,zoom:{controls:true,wheel:true,startScale:.75,minScale:.35,maxScale:1.5},move:{scrollbars:true,drag:true,wheel:true},sounds:false,maxBlocks:MISSION_LIMITS.maxCommands*2+1});workspace.current=w;
    const listener=(event:Blockly.Events.Abstract)=>{if(!event.isUiEvent&&!lockedRef.current)report();};w.addChangeListener(listener);
    const resize=()=>Blockly.svgResize(w);const observer=new ResizeObserver(resize);observer.observe(host.current!);
    // Details panels may be hidden until opened. Re-measure when their size changes.
    return()=>{observer.disconnect();w.removeChangeListener(listener);workspace.current=null;w.dispose();};
  },[]);
  useEffect(()=>{const w=workspace.current;if(!w)return;try{const state=missionToState(mission);Blockly.Events.disable();try{Blockly.serialization.workspaces.load(state,w);}finally{Blockly.Events.enable();}w.scrollCenter();setNotice('');}catch(error){setNotice(error instanceof Error?error.message:'任務無法轉成積木');}},[mission]);
  useEffect(()=>{const w=workspace.current;if(!w)return;for(const block of w.getAllBlocks(false)){block.setMovable(!locked);block.setEditable(!locked);block.setDeletable(!locked);}},[locked,mission]);
  const save=()=>{try{localStorage.setItem('drone-blockly-workspace',JSON.stringify(savedWorkspace(workspace.current!)));setNotice('積木工作區已儲存在此瀏覽器');}catch{setNotice('無法儲存，請確認瀏覽器儲存空間');}};
  const load=(text:string)=>{try{const state=readSavedWorkspace(text);Blockly.Events.disable();try{Blockly.serialization.workspaces.load(state,workspace.current!);}finally{Blockly.Events.enable();}report();setNotice('已載入積木工作區，請確認後執行');}catch(error){setNotice(error instanceof Error?error.message:'工作區載入失敗');}};
  return <section className="blockly-editor" aria-label="圖像化任務編輯器">
    <p className="mission-hint">從工具箱拖曳動作，接到任務起點內。積木由上而下執行；選填參數須先勾選「設定」。</p>
    <div className="blockly-workspace" ref={host} id="mission-blocks" tabIndex={-1} aria-label="任務積木工作區" inert={locked}/>
    <div className="mission-files"><button disabled={locked} onClick={save}>儲存積木</button><button disabled={locked} onClick={()=>{try{const saved=localStorage.getItem('drone-blockly-workspace');if(saved)load(saved);else setNotice('此瀏覽器沒有已儲存的積木');}catch{setNotice('瀏覽器不允許讀取儲存的積木');}}}>載入積木</button>
      <button disabled={locked} onClick={()=>{const url=URL.createObjectURL(new Blob([JSON.stringify(savedWorkspace(workspace.current!))],{type:'application/octet-stream'}));const a=document.createElement('a');a.href=url;a.download='mission.droneblocks';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}}>下載積木檔</button>
      <label className={'file-button '+(locked?'disabled':'')}>開啟積木檔<input type="file" accept=".droneblocks" disabled={locked} onChange={async event=>{const file=event.target.files?.[0];event.target.value='';if(!file)return;if(file.size>200000){setNotice('積木檔案過大');return;}try{load(await file.text());}catch{setNotice('無法讀取積木檔案');}}}/></label>
    </div>{notice&&<p role="status">{notice}</p>}
  </section>;
});
