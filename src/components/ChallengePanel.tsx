import { useState,useSyncExternalStore } from 'react';
import type { ChallengeManager } from '../challenges/ChallengeManager';
import { RacingReadout } from './RacingReadout';
import { PrecisionLandingReadout } from './PrecisionLandingReadout';
import { personalBests } from '../challenges/repository';
import { PhotoHuntReadout } from './PhotoHuntReadout';
import type { PhotoAlbum } from '../challenges/photoHunt/PhotoAlbum';
import type { ChallengeResult } from '../challenges/types';
import { ChallengeHud,type HudTelemetry } from './ChallengeHud';
const labels={IDLE:'挑戰主選單',LOADING:'載入中',READY:'準備就緒',COUNTDOWN:'起飛倒數',RUNNING:'挑戰中',PAUSED:'已暫停',COMPLETED:'挑戰完成',FAILED:'挑戰失敗',ABORTED:'已中止'};
export function ChallengePanel({manager,open,onOpen,onClose,onExample,onTakeover,canTakeover=false,photoAlbum,onPhoto,telemetry}:{manager:ChallengeManager;open:boolean;onOpen:()=>void;onClose:()=>void;onExample:(value:unknown)=>void;onTakeover?:()=>void;canTakeover?:boolean;photoAlbum?:PhotoAlbum;onPhoto?:()=>Promise<unknown>;telemetry?:HudTelemetry}){
  const s=useSyncExternalStore(manager.subscribe,()=>manager.snapshot),[error,setError]=useState('');
  const [photoRecord,setPhotoRecord]=useState<ChallengeResult|null>(null);
  const action=(fn:()=>void|Promise<void>)=>{setError('');try{Promise.resolve(fn()).catch(e=>setError(String(e)));}catch(e){setError(String(e));}};
  const running=s.status==='RUNNING'||s.status==='PAUSED'||s.status==='COUNTDOWN';
  const racing=s.definition?.objectives.some(o=>o.type==='waypoint-race');
  const landing=s.definition?.objectives.some(o=>o.type==='precision-landing');
  const hunt=s.definition?.objectives.some(o=>o.type==='photo-hunt');
  const records=manager.records(),bestRows=(s.definition?[s.definition]:manager.registry.list()).flatMap(definition=>personalBests(records,definition).map(result=>({definition,result})));
  return <>
    {!open&&s.status!=='IDLE'&&<ChallengeHud telemetry={telemetry} snapshot={s} onOpen={onOpen} onPause={()=>s.status==='PAUSED'?manager.resume():manager.pause()} onTakeover={onTakeover} canTakeover={canTakeover} onPhoto={onPhoto}/>}
    {open&&<section className="challenge-panel" aria-label="挑戰關卡"><div className="challenge-title"><h2>{labels[s.status]}</h2><button onClick={onClose} aria-label="收起關卡視窗">×</button></div>
      {s.status==='IDLE'?<><p>同一個目標，可以手動、任務或混合飛行完成。選關後會重置飛機。</p><div className="challenge-cards">{manager.registry.list().map(d=><button key={d.id} onClick={()=>action(()=>manager.select(d.id))}><img src={d.thumbnail} alt=""/><b>{d.title}</b><small>{d.difficulty} · {d.time_limit}s</small><span>{d.description}</span></button>)}</div></>:<>
        <h3>{s.definition?.title}</h3><p>{s.definition?.description}</p><p className="challenge-message" role="status">{s.message}</p>
        {s.status==='COUNTDOWN'&&<strong className="challenge-countdown">{Math.ceil(s.countdown)}</strong>}
        <p>{s.elapsed.toFixed(1)} / {s.definition?.time_limit} 秒 · Seed {s.definition?.scene.seed}</p>
        {racing?<RacingReadout snapshot={s} waypoints/>:<ol className="challenge-objectives">{s.objectives.map(o=><li key={o.id}>{o.completed?'✓':'○'} {o.title}<progress max={1} value={o.progress}/></li>)}</ol>}
        {landing&&<PrecisionLandingReadout snapshot={s} details/>}
        {hunt&&<PhotoHuntReadout snapshot={s} album={photoAlbum} onPhoto={onPhoto} details/>}
        {s.violations.length>0&&<p role="alert">違規 {s.violations.length} 次：{s.violations.at(-1)?.message}</p>}
        <div className="challenge-actions">
          {s.status==='READY'&&<button className="primary" onClick={()=>{manager.start();onClose();}}>開始挑戰（3 秒倒數）</button>}
          {running&&<button onClick={()=>s.status==='PAUSED'?manager.resume():manager.pause()}>{s.status==='PAUSED'?'繼續':'暫停'}</button>}
          {running&&<button onClick={()=>manager.abort()}>中止挑戰</button>}
          {canTakeover&&s.status==='RUNNING'&&<button onClick={onTakeover}>手動接管（繼續本次挑戰）</button>}
          {!!s.definition?.metadata.example_mission&&<button disabled={!['READY','RUNNING'].includes(s.status)} onClick={()=>onExample(s.definition!.metadata.example_mission)}>載入示範 JSON 任務</button>}
          {['COMPLETED','FAILED','ABORTED'].includes(s.status)&&<button onClick={()=>action(()=>manager.retry())}>重新挑戰</button>}
          {hunt&&['READY','COMPLETED','FAILED','ABORTED'].includes(s.status)&&<button onClick={()=>action(()=>manager.retry(crypto.getRandomValues(new Uint32Array(1))[0]))}>新 Seed 重新配置</button>}
          <button onClick={()=>manager.menu()}>返回主選單／自由飛行</button>
        </div>
        {s.result&&<section aria-label="成績明細"><h3>{s.result.final_score} {s.result.score_unit}（{s.result.score_direction==='higher'?'越高越好':'越低越好'}）</h3><p>{s.result.control_source} · {s.result.completion_time.toFixed(2)} 秒 · {s.result.status}</p><p>{s.result.status!=='COMPLETED'?'未完成，不列入最佳紀錄':s.result.is_personal_best?'★ 刷新此控制來源的最佳紀錄':'未刷新最佳紀錄'}{s.result.previous_best!=null?` · 前次最佳 ${s.result.previous_best} ${s.result.score_unit}`:''}</p><ul>{s.result.lines.map((l,i)=><li key={i}>{l.label}：{l.value.toFixed(3)}</li>)}</ul><p>控制紀錄：{s.result.control_history.map(h=>`${h.time.toFixed(1)}s ${h.source}`).join(' → ')||'尚未飛行'}</p><p>航程 {s.result.trajectory_summary.distance.toFixed(2)}m · 最高 {s.result.trajectory_summary.max_altitude.toFixed(2)}m</p>{racing&&<p>{s.result.status==='COMPLETED'?'已在最後航點停止計時。飛機暫停於空中，返回自由飛行後可按「降落」。':'本次未完成競速；飛機已暫停，可重試或返回自由飛行。'}</p>}</section>}
      </>}
      {(s.storage_error||error)&&<p role="alert">{s.storage_error||error}</p>}
      <section aria-label="個人最佳成績"><h4>個人最佳成績（目前關卡設定）</h4>{bestRows.length?<ul>{bestRows.map(({definition,result:r})=><li key={r.attempt_id}>{definition.title} · {r.control_source} · {r.final_score} {r.score_unit}{definition.metadata.experience==='photo-hunt'&&<button onClick={()=>setPhotoRecord(r)}>查看最佳攝影紀錄</button>}</li>)}</ul>:<p>尚無完成紀錄</p>}</section>
      {photoRecord&&<section aria-label="已儲存攝影紀錄"><h4>已儲存紀錄 · {photoRecord.final_score} 分 · {photoRecord.completion_time.toFixed(2)} 秒 · Seed {photoRecord.seed}</h4><button onClick={()=>setPhotoRecord(null)}>關閉攝影紀錄</button><PhotoHuntReadout snapshot={{...s,definition:manager.registry.get(photoRecord.challenge_id),status:photoRecord.status,elapsed:photoRecord.completion_time,control_source:photoRecord.control_source,metrics:photoRecord.metrics??{},result:photoRecord}} album={photoAlbum} details/></section>}
      <details><summary>本機最近成績</summary><ul>{records.slice(0,10).map(r=><li key={r.attempt_id}>{r.challenge_id} · {r.status} · {r.final_score} {r.score_unit} · {r.control_source}</li>)}</ul></details>
    </section>}
  </>;
}
