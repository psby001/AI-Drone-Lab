import { useEffect,useState } from 'react';
import type { ChallengeSnapshot } from '../challenges/types';
import type { HuntParams } from '../challenges/photoHunt/rule';
import { readHuntProgress } from '../challenges/photoHunt/rule';
import type { PhotoAlbum } from '../challenges/photoHunt/PhotoAlbum';
export function PhotoThumbnail({id,album}:{id:string;album:PhotoAlbum}){
  const [url,setUrl]=useState('');
  useEffect(()=>{let active=true,current='',sequence=0;const load=async()=>{const request=++sequence,blob=await album.get(id);if(!active||request!==sequence)return;if(current)URL.revokeObjectURL(current);current=blob?URL.createObjectURL(blob):'';setUrl(current);};void load();const off=album.subscribe(()=>void load());return()=>{active=false;off();if(current)URL.revokeObjectURL(current);};},[id,album]);
  return url?<a href={url} download={`${id}.jpg`}><img className="hunt-photo" src={url} alt="本次拍攝照片縮圖"/></a>:<small>縮圖處理中或已清除；原始照片可在相機下載。</small>;
}
export function PhotoHuntReadout({snapshot:s,album,onPhoto,details=false}:{snapshot:ChallengeSnapshot;album?:PhotoAlbum;onPhoto?:()=>Promise<unknown>;details?:boolean}){
  const objective=s.definition?.objectives.find(o=>o.type==='photo-hunt'),[busy,setBusy]=useState(false),[error,setError]=useState(''),[albumWarning,setAlbumWarning]=useState(album?.warning??'');
  useEffect(()=>album?.subscribe(()=>setAlbumWarning(album.warning)),[album]);
  if(!objective)return null;
  const targets=(objective.params as unknown as HuntParams).targets,p=readHuntProgress(s.metrics[objective.id]),latest=p.latest,observed=latest?.evaluations.filter(e=>e.in_frame&&e.visibility_score>0)??[];
  const average=Object.values(p.best).reduce((n,e)=>n+e.total_score,0)/targets.length;
  return <section className={'hunt-readout '+(details?'hunt-details':'')} aria-label="攝影尋寶資訊">
    <b>剩餘 {Math.max(0,(s.definition?.time_limit??300)-s.elapsed).toFixed(0)} 秒 · 已找到 {p.found}/{targets.length}</b>
    <ul>{targets.map(t=><li key={t.object_id}>{p.best[t.object_id]?'✓':'○'} {t.display_name} · {p.best[t.object_id]?.total_score.toFixed(1)??'—'} 分{details&&s.status==='READY'&&<small>{t.target_description}</small>}</li>)}</ul>
    <span>{s.control_source} · 拍照 {p.shot_count} 次 · 平均 {average.toFixed(1)} 分</span>
    {onPhoto&&<button className="primary" disabled={s.status!=='RUNNING'||busy} onClick={()=>{setBusy(true);setError('');void onPhoto().catch(e=>setError(String(e))).finally(()=>setBusy(false));}}>{busy?'處理照片…':'📷 拍照評分'}</button>}
    {error&&<p role="alert">{error}</p>}
    {details&&albumWarning&&<p role="alert">{albumWarning}</p>}
    {latest&&<p role="status">{observed.length?observed.map(e=>e.is_valid?`${targets.find(t=>t.object_id===e.target_id)?.display_name}：拍攝成功！${e.total_score.toFixed(1)} 分`:`${targets.find(t=>t.object_id===e.target_id)?.display_name}：${e.rejection_reasons.join('、')}`).join('；'):'尚未找到目標，請繼續探索'}</p>}
    {details&&<>
      {s.status==='READY'&&<><p>遮擋可見率 ≥20%、入框率 ≥20%、實際可見影像面積 ≥3%。完整入鏡 40 分、置中 30 分、大小 30 分；目標占畫面 15–30% 最佳。</p><p>公開區域：西側停車場、東北公園露營區、東南貨櫃區。可載入公開區域巡拍任務，再調整路線與雲台。</p></>}
      {latest&&<section aria-label="最新照片評分"><h4>最新照片</h4>{album&&<PhotoThumbnail id={latest.photo_id} album={album}/>}<p>挑戰 {latest.elapsed.toFixed(2)}s · {new Date(latest.timestamp).toLocaleTimeString()}</p>{observed.map(e=><article key={e.target_id}><b>{targets.find(t=>t.object_id===e.target_id)?.display_name} · {e.is_valid?'有效':'無效'}</b><p>入鏡 {e.visibility_score.toFixed(1)}/40 · 構圖 {e.composition_score.toFixed(1)}/30 · 大小 {e.size_score.toFixed(1)}/30 · 總分 {e.total_score.toFixed(1)}</p><p>{e.suggestions.join(' ')||'構圖良好。'} {e.rejection_reasons.join('、')}</p></article>)}</section>}
      {Object.keys(p.best).length>0&&<section aria-label="最佳照片"><h4>各目標最佳照片</h4>{targets.map(t=>{const e=p.best[t.object_id];return <article key={t.object_id}><b>{t.display_name} · {e?`${e.total_score.toFixed(1)} 分`:'尚未找到'}</b>{e&&<>{album&&<PhotoThumbnail id={e.photo_id} album={album}/>}<small>入鏡 {e.visibility_score.toFixed(1)} · 構圖 {e.composition_score.toFixed(1)} · 大小 {e.size_score.toFixed(1)}</small></>}</article>;})}</section>}
    </>}
  </section>;
}
