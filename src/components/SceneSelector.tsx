import { useState,useSyncExternalStore } from 'react';
import type { FreeSceneManager } from '../scenes/FreeFlightScenes';
export function SceneSelector({manager,needsConfirmation,onClose}:{manager:FreeSceneManager;needsConfirmation:boolean;onClose:()=>void}){
  const s=useSyncExternalStore(manager.subscribe,manager.getSnapshot);
  const [selected,setSelected]=useState(s.active?.id??'training'),[confirm,setConfirm]=useState(false);
  const load=async()=>{setConfirm(false);if(await manager.switchScene(selected))onClose();};
  return <div className="scene-selector-backdrop"><section className="scene-selector" role="dialog" aria-modal="true" aria-labelledby="scene-selector-title" onKeyDown={event=>{if(event.key==='Escape'){event.stopPropagation();onClose();}}}>
    <div className="picker-title"><h2 id="scene-selector-title">自由飛行場景</h2><button autoFocus onClick={onClose} aria-label="關閉場景選單">×</button></div>
    <p>選擇場景後開始飛行。切換會重設無人機與雲台。</p>
    <div className="scene-cards">{manager.listScenes().map(d=><button key={d.id} className={selected===d.id?'selected':''} aria-pressed={selected===d.id} onClick={()=>{setSelected(d.id);setConfirm(false);}}><img src={d.thumbnail} alt=""/><strong>{d.title}</strong><small>{d.category} · 半徑 {d.flight_bounds.radius}m · 限高 {d.max_altitude}m</small><span>{d.description}</span></button>)}</div>
    {s.status==='LOADING'&&<p role="status">載入場景中…仍可選擇其他場景。</p>}{s.error&&<p role="alert">{s.error}。請重試或選擇其他場景。</p>}
    {confirm?<div role="alert"><p>切換場景將中止目前飛行及 AI 任務，是否繼續？</p><button onClick={()=>void load()}>確認切換</button><button onClick={()=>setConfirm(false)}>取消</button></div>:<button className="primary" onClick={()=>needsConfirmation?setConfirm(true):void load()}>開始飛行</button>}
  </section></div>;
}
