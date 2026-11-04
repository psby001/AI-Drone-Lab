import { useEffect,useRef,useState,useSyncExternalStore } from 'react';
import type { DroneScene } from '../render/DroneScene';
import type { CameraMediaState } from '../camera/DroneCamera';
import type { CameraSnapshot } from '../groundTruth/types';
import { exportYolo,snapshotJson } from '../groundTruth/GroundTruthService';
const empty:CameraMediaState={assets:[],recording:false,stopping:false,message:'初始化',recordingSupported:false},noSubscribe=()=>()=>{},emptyMedia=()=>empty;
export function GroundTruthPanel({scene,canSwitch,onLoadTest,onClearTest,onTestFlight,onClose}:{scene:DroneScene|null;canSwitch:boolean;onLoadTest:()=>void;onClearTest:()=>void;onTestFlight:()=>void;onClose:()=>void}){
  const [enabled,setEnabled]=useState(false),[snapshot,setSnapshot]=useState<CameraSnapshot|null>(null),[selected,setSelected]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const [urls,setUrls]=useState<{image:string;json:string;yolo:string;classes:string}|null>(null),mounted=useRef(true);
  const media=useSyncExternalStore(scene?.payloadCamera.subscribeStatus??noSubscribe,scene?.payloadCamera.getSnapshot??emptyMedia);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  useEffect(()=>{scene?.setGroundTruthDebug(enabled);return()=>scene?.setGroundTruthDebug(false);},[scene,enabled]);
  useEffect(()=>{if(!snapshot||!scene){setUrls(null);return;}const values={image:URL.createObjectURL(snapshot.image_data),json:URL.createObjectURL(new Blob([snapshotJson(snapshot)],{type:'application/json'})),yolo:URL.createObjectURL(new Blob([exportYolo(snapshot)],{type:'text/plain'})),classes:URL.createObjectURL(new Blob([JSON.stringify(scene.internalGroundTruth.registry.getClasses(),null,2)],{type:'application/json'}))};setUrls(values);return()=>{Object.values(values).forEach(URL.revokeObjectURL);};},[snapshot,scene]);
  const act=(fn:()=>unknown)=>{setError('');try{fn();}catch(e){setError(e instanceof Error?e.message:'操作失敗');}};
  const capture=async()=>{if(!scene)return;setBusy(true);setError('');try{const photo=await scene.captureAnnotatedPhoto();if(mounted.current){setSnapshot(photo);setSelected(photo.photo_id);}}catch(e){if(mounted.current)setError(e instanceof Error?e.message:'拍攝失敗');}finally{if(mounted.current)setBusy(false);}};
  return <section className="gt-panel" aria-label="Ground Truth 開發者工具"><div className="gt-title"><h2>Ground Truth 開發者工具</h2><button onClick={onClose} aria-label="關閉 Ground Truth 工具">×</button></div>
    <p>內部真值僅供測試／資料集使用，不提供給一般玩家或 AI 規劃器。純前端隔離不是安全邊界。</p>
    <label><input type="checkbox" checked={enabled} onChange={e=>setEnabled(e.target.checked)}/> 顯示 3D Bounding Box、Frustum 與照片 2D 標註</label>
    <div className="gt-actions"><button disabled={!scene||!canSwitch} onClick={()=>act(onLoadTest)}>載入 GT 測試場景（重置飛機）</button><button disabled={!canSwitch} onClick={()=>act(onClearTest)}>返回一般場景</button><button disabled={!scene||!canSwitch} onClick={()=>act(onTestFlight)}>測試飛行：8m 斜拍</button><button disabled={!scene||busy} onClick={capture}>{busy?'計算中…':'拍照並計算 GT'}</button></div>
    <p>場景：{scene?.internalGroundTruth.sceneId??'初始化'}。遮擋只在拍照時計算；3D 框是即時姿態，以下 2D 疊圖是固定照片。</p>
    <label>已拍照片<select value={selected} onChange={e=>setSelected(e.target.value)}><option value="">選擇照片</option>{media.assets.filter(a=>a.photo_id).map(a=><option key={a.photo_id} value={a.photo_id}>{a.name}</option>)}</select></label><button disabled={!scene||!selected} onClick={()=>act(()=>{const photo=scene!.internalGroundTruth.getPhotoSnapshot(selected);if(!photo)throw new Error('此照片標註不存在或已移除');setSnapshot(photo);})}>查詢同張照片標註</button>
    {error&&<p role="alert">{error}</p>}
    {snapshot&&urls&&<><p>Photo {snapshot.photo_id}<br/>Frame #{snapshot.frame_id} · 模擬 {snapshot.simulation_time.toFixed(3)}s · {snapshot.image_width}×{snapshot.image_height} · {snapshot.scene_id}</p>
      <div className="gt-image"><img src={urls.image} alt="固定拍攝影像"/>{enabled&&<svg viewBox={`0 0 ${snapshot.image_width} ${snapshot.image_height}`} aria-label="Ground Truth 2D Bounding Boxes">{snapshot.object_annotations.filter(a=>a.bounding_box_2d).map(a=>{const b=a.bounding_box_2d!,color=!a.is_valid_annotation||a.visibility_state==='mostly_occluded'?'#f3675d':a.is_occluded||a.is_partially_outside?'#ffd35b':'#52e193';return <g key={a.object_id} fill="none" stroke={color} strokeWidth="3"><rect x={b.x} y={b.y} width={b.width} height={b.height}/><text x={b.x+3} y={Math.max(16,b.y-5)} stroke="none" fill={color} fontSize="17">{a.object_id} · {a.class_name} · {(a.visibility_ratio*100).toFixed(0)}%</text></g>;})}</svg>}</div>
      <div className="gt-actions"><a href={urls.image} download={`${snapshot.photo_id}.png`}>下載影像</a><a href={urls.json} download={`${snapshot.photo_id}.json`}>下載標註 JSON</a><a href={urls.yolo} download={`${snapshot.photo_id}.txt`}>下載 YOLO labels</a><a href={urls.classes} download="classes.json">下載類別表</a></div>
      <div className="gt-table"><table><thead><tr><th>目標／類別</th><th>可見率</th><th>入框率</th><th>影像可見面積</th><th>狀態</th></tr></thead><tbody>{snapshot.object_annotations.map(a=><tr key={a.object_id}><td>{a.object_id} / {a.class_name}</td><td>{(a.visibility_ratio*100).toFixed(1)}%</td><td>{(a.in_frame_ratio*100).toFixed(1)}%</td><td>{(a.visible_area_ratio*100).toFixed(2)}%</td><td>{a.visibility_state}{a.is_partially_outside?' / 部分出框':''}{!a.is_valid_annotation?' / 無效':''}</td></tr>)}</tbody></table></div>
      <p>可見率分母為影像內實際打中目標的射線；入框率是 3D 包圍盒投影輪廓估計。小目標、細枝及透明材質有取樣誤差。</p></>}
  </section>;
}
