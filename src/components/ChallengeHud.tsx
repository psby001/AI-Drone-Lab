import { useEffect,useState } from 'react';
import type { ChallengeSnapshot } from '../challenges/types';
import { RacingReadout } from './RacingReadout';
import { PrecisionLandingReadout } from './PrecisionLandingReadout';
import { PhotoHuntReadout } from './PhotoHuntReadout';
import type { HuntParams } from '../challenges/photoHunt/rule';
import type { RacingParams } from '../challenges/racing';
const labels={IDLE:'主選單',LOADING:'載入中',READY:'準備就緒',COUNTDOWN:'倒數',RUNNING:'挑戰中',PAUSED:'已暫停',COMPLETED:'挑戰完成',FAILED:'挑戰失敗',ABORTED:'已中止'};
export interface HudTelemetry {altitude:number;speed:number;heading:number}
export function ChallengeHud({snapshot:s,onOpen,onPause,onTakeover,onPhoto,canTakeover=false,telemetry}:{snapshot:ChallengeSnapshot;onOpen:()=>void;onPause:()=>void;onTakeover?:()=>void;onPhoto?:()=>Promise<unknown>;canTakeover?:boolean;telemetry?:HudTelemetry}){
  const [expanded,setExpanded]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
  useEffect(()=>{setExpanded(false);setError('');},[s.definition?.id,s.definition?.scene.seed,s.status==='READY']);
  const race=s.definition?.objectives.find(o=>o.type==='waypoint-race'),hunt=s.definition?.objectives.find(o=>o.type==='photo-hunt'),landing=s.definition?.objectives.some(o=>o.type==='precision-landing');
  const running=['COUNTDOWN','RUNNING','PAUSED'].includes(s.status),m=s.metrics[(hunt??race)?.id??'']??{};
  const progress=hunt?`${Number(m.found??0)}/${(hunt.params as unknown as HuntParams).targets.length}`:race?`${Number(m.completed_waypoints??0)}/${(race.params as unknown as RacingParams).waypoints.length}`:`${s.objectives.filter(o=>o.completed).length}/${s.objectives.length}`;
  return <section className={`challenge-hud ${race?'racing-hud':''} ${hunt?'hunt-hud':''} ${expanded?'hud-expanded':''} ${telemetry?'has-telemetry':''}`} aria-label="挑戰 HUD">
    <b className="challenge-desktop-title">{s.definition?.title} · {labels[s.status]}{s.status==='COUNTDOWN'?` ${Math.ceil(s.countdown)}`:''}</b>
    <button className="challenge-mobile-summary" aria-label={expanded?'收起挑戰提示':'展開挑戰提示'} aria-expanded={expanded} aria-controls="challenge-hud-details" onClick={()=>setExpanded(!expanded)}><b>{s.definition?.title.split(' ')[0]} · {progress}</b><span>{s.status==='COUNTDOWN'?`倒數 ${Math.ceil(s.countdown)}`:s.status==='RUNNING'?`剩餘 ${Math.max(0,(s.definition?.time_limit??0)-s.elapsed).toFixed(0)}s`:labels[s.status]} {expanded?'▴':'▾'}</span></button>
    {telemetry&&<div className="challenge-mobile-telemetry" aria-label="挑戰飛行儀表"><span><small>高度 m</small><b>{telemetry.altitude.toFixed(1)}</b></span><span><small>速度 m/s</small><b>{telemetry.speed.toFixed(1)}</b></span><span><small>航向 °</small><b>{telemetry.heading.toFixed(0)}</b></span></div>}
    <div id="challenge-hud-details" className="challenge-hud-details">
      {hunt?<PhotoHuntReadout snapshot={s}/>:race?<RacingReadout snapshot={s}/>:<><span>{s.elapsed.toFixed(1)} / {s.definition?.time_limit}s · {progress}</span><small>{s.objectives.find(o=>!o.completed)?.title}</small></>}
      {landing&&<PrecisionLandingReadout snapshot={s}/>}
    </div>
    <div className="challenge-hud-actions">
      {running&&<button className="hud-pause-button" onClick={onPause}>{s.status==='PAUSED'?'繼續':'暫停'}</button>}
      {hunt&&onPhoto&&<button className="hud-photo-button" aria-label="拍照評分" disabled={s.status!=='RUNNING'||busy} onClick={()=>{setBusy(true);setError('');void onPhoto().catch(e=>setError(String(e))).finally(()=>setBusy(false));}}>{busy?'處理中':<>📷 <span className="hud-long-label">拍照評分</span></>}</button>}
      <button aria-label="關卡詳情" onClick={onOpen}><span className="hud-long-label">關卡</span>詳情</button>
      {canTakeover&&s.status==='RUNNING'&&<button aria-label="手動接管" onClick={onTakeover}><span className="hud-long-label">手動</span>接管</button>}
    </div>
    {error&&<p role="alert">{error}</p>}
  </section>;
}
