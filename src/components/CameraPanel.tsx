import { useEffect,useRef,useState,useSyncExternalStore } from 'react';
import { CameraController } from '../camera/CameraController';
import type { DroneCamera,CameraMediaState } from '../camera/DroneCamera';
import { CAMERA_RESOLUTIONS,type CameraView,type GimbalMode } from '../camera/types';
import { useMobileCameraLayout } from '../camera/useMobileCameraLayout';
const EMPTY:CameraMediaState={recording:false,stopping:false,assets:[],message:'相機初始化中',recordingSupported:false};
const noSubscribe=()=>()=>{},emptySnapshot=()=>EMPTY;
export function CameraPanel({controller,provider,locked,heading}:{controller:CameraController;provider:DroneCamera|null;locked:boolean;heading:number}){
  const settings=useSyncExternalStore(controller.subscribe,()=>controller.snapshot);
  const media=useSyncExternalStore(provider?.subscribeStatus??noSubscribe,provider?.getSnapshot??emptySnapshot);
  const host=useRef<HTMLDivElement>(null),panel=useRef<HTMLElement>(null);
  const [error,setError]=useState(''),[expanded,setExpanded]=useState(false);
  const [nativeFullscreen,setNativeFullscreen]=useState(false);
  const [settingsOpen,setSettingsOpen]=useState(false);
  const layout=useMobileCameraLayout(settings.enabled,nativeFullscreen,settings.width/settings.height);
  useEffect(()=>{const changed=()=>{const active=document.fullscreenElement===panel.current&&!!panel.current;setNativeFullscreen(active);if(!active)setExpanded(false);};document.addEventListener('fullscreenchange',changed);return()=>document.removeEventListener('fullscreenchange',changed);},[]);
  const metadata=provider?.getMetadata();
  useEffect(()=>{if(provider&&host.current)host.current.appendChild(provider.canvas);return()=>{provider?.canvas.remove();};},[provider,settings.enabled]);
  if(!settings.enabled)return null;
  const act=(fn:()=>unknown)=>{setError('');try{Promise.resolve(fn()).catch(reason=>setError(reason instanceof Error?reason.message:'相機操作失敗'));}catch(reason){setError(reason instanceof Error?reason.message:'相機操作失敗');}};
  const full=()=>{setError('');if(document.fullscreenElement===panel.current){act(()=>document.exitFullscreen());return;}if(panel.current?.requestFullscreen){setExpanded(true);void panel.current.requestFullscreen().catch(()=>{setExpanded(true);setError('瀏覽器未允許原生全螢幕，已放大視窗');});}else setExpanded(!expanded);};
  return <section ref={panel} className={'payload-camera '+(expanded?'expanded ':'')+(layout.mobile?'mobile-fit ':'')+(settingsOpen?'camera-settings-open':'')} style={layout.mobile?layout.rect?{left:layout.rect.x,top:layout.rect.y,width:layout.rect.width,height:layout.rect.height,right:'auto',bottom:'auto',transform:'none',maxHeight:'none',maxWidth:'none'}:{display:'none'}:undefined} aria-label="無人機相機與雲台">
    <div className="payload-title" style={layout.mobile?{height:40,minHeight:40,flex:'0 0 40px'}:undefined}><b>{media.recording?'● 錄影中':'📷 機載相機'}</b><button className="desktop-camera-expand" disabled={nativeFullscreen} onClick={()=>setExpanded(!expanded)}>{expanded?'縮小視窗':'放大視窗'}</button><button className="mobile-camera-control" aria-label="相機拍照" disabled={!provider} onClick={()=>act(()=>provider!.capturePhoto())}>📷</button><button className="mobile-camera-control" aria-expanded={settingsOpen} aria-controls="camera-settings" onClick={()=>setSettingsOpen(!settingsOpen)}>{settingsOpen?'關閉設定':'設定'}</button><button className="desktop-camera-fullscreen" onClick={full}>{nativeFullscreen?'退出全螢幕':'全螢幕'}</button><button aria-label="關閉相機視窗" onClick={()=>controller.setEnabled(false)}>✕</button></div>
    <div className="payload-image" ref={host} style={layout.mobile?{height:'auto',minHeight:0,flex:'1 1 auto',width:'100%',margin:0,aspectRatio:'auto'}:undefined}/>
    <div id="camera-settings" className="payload-scroll">
      <button className="mobile-camera-control" onClick={full}>全螢幕</button>
      <p className="camera-readout">{settings.width}×{settings.height} · {settings.fps} FPS · Pitch {settings.pitch}° / Yaw {settings.yaw.toFixed(1)}° · {settings.mode==='body'?'機體跟隨':'航向穩定'}<br/>FOV {settings.fov}°（垂直） · 機體航向 {heading.toFixed(1)}°</p>
      {metadata&&<p className="camera-note">影格 #{metadata.frame_id} · 鏡頭 ENU：{metadata.camera_pose.position.east.toFixed(2)}, {metadata.camera_pose.position.north.toFixed(2)}, {metadata.camera_pose.position.up.toFixed(2)}m</p>}
      <div className="camera-actions"><button disabled={!provider} onClick={()=>act(()=>provider!.capturePhoto())}>拍照</button><button disabled={!provider||!media.recordingSupported||media.stopping||(locked&&!media.recording)} onClick={()=>act(()=>media.recording?provider!.stopRecording():provider!.startRecording())}>{media.stopping?'影片輸出中':media.recording?'停止錄影':'開始錄影'}</button><button disabled={locked||settings.fov<=25} onClick={()=>controller.setFov(Math.max(25,settings.fov-10))}>放大</button><button disabled={locked||settings.fov>=110} onClick={()=>controller.setFov(Math.min(110,settings.fov+10))}>縮小</button></div>
      {!media.recordingSupported&&<p className="camera-note">此瀏覽器不支援錄影；拍照仍可使用。</p>}
      <p className="camera-note" role="status">{error||media.message}</p>
      <fieldset disabled={locked}><legend>雲台與影像設定{locked?'（任務控制中）':''}</legend>
        <label>相機視角<select value={settings.view} onChange={e=>controller.setView(e.target.value as CameraView)}><option value="fpv">FPV・機頭前方</option><option value="nadir">Nadir・垂直向下</option><option value="oblique">Oblique・斜向下</option><option value="custom">Custom・自訂</option></select></label>
        <label>雲台模式<select value={settings.mode} onChange={e=>controller.setMode(e.target.value as GimbalMode)}><option value="body">機體跟隨</option><option value="stabilized">航向跟隨穩定（抑制俯仰／側傾）</option></select></label>
        <p className="camera-readout">Yaw 為相對機頭偏角，0° 朝機頭、正值向右。穩定模式跟隨機頭轉向，並抵消機身俯仰與側傾。</p>
        <label>Pitch {settings.pitch}°<input aria-label="雲台 Pitch" type="range" min="-90" max="30" step="1" value={settings.pitch} onChange={e=>controller.setAngle('pitch',Number(e.target.value))}/></label>
        <label>Yaw {settings.yaw.toFixed(1)}°<input aria-label="雲台 Yaw" type="range" min="-180" max="180" step="1" value={settings.yaw} onChange={e=>controller.setAngle('yaw',Number(e.target.value))}/></label>
        <button onClick={()=>controller.reset()}>重置雲台</button>
        <label>垂直 FOV {settings.fov}°<input aria-label="相機 FOV" type="range" min="25" max="110" value={settings.fov} onChange={e=>controller.setFov(Number(e.target.value))}/></label>
        <label>影像解析度<select disabled={media.recording||media.stopping} value={`${settings.width}×${settings.height}`} onChange={e=>{const [w,h]=CAMERA_RESOLUTIONS[e.target.value as keyof typeof CAMERA_RESOLUTIONS];controller.setResolution(w,h);}}>{Object.keys(CAMERA_RESOLUTIONS).map(name=><option key={name}>{name}</option>)}</select></label>
        <label>相機更新頻率<select disabled={media.recording||media.stopping} value={settings.fps} onChange={e=>controller.setFps(Number(e.target.value))}>{[5,10,15,30].map(fps=><option key={fps} value={fps}>{fps} FPS</option>)}</select></label>
        <button disabled={media.recording||media.stopping} onClick={()=>controller.lowQuality()}>手機低畫質（640×360／10FPS）</button>
        <details><summary>相機安裝外參（機體座標，公尺／度）</summary>{(['right','forward','up','pitch','yaw','roll'] as const).map(axis=><label key={axis}>{axis}<input aria-label={`相機安裝 ${axis}`} type="number" step={['right','forward','up'].includes(axis)?0.01:1} min={['right','forward','up'].includes(axis)?-0.5:-180} max={['right','forward','up'].includes(axis)?0.5:180} value={settings.mount[axis]} onChange={e=>act(()=>controller.setMount({...settings.mount,[axis]:Number(e.target.value)}))}/></label>)}</details>
      </fieldset>
      {media.assets.length>0&&<div className="camera-assets"><b>拍攝成果（最多 8 份／合計 64MiB，超出移除最舊）</b>{media.assets.map(asset=><div key={asset.id}><a href={asset.url} download={asset.name}>{asset.kind==='photo'?'下載照片':'下載影片'} · {(asset.bytes/1024).toFixed(0)}KB</a><button aria-label={`移除 ${asset.name}`} onClick={()=>provider?.deleteAsset(asset.id)}>移除</button></div>)}</div>}
    </div>
  </section>;
}
