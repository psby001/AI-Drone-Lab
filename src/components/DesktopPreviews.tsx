import { useEffect,useRef,useState } from 'react';
import type { DroneScene } from '../render/DroneScene';
export const DESKTOP_PREVIEW_QUERY='(min-width: 701px) and (min-height: 601px), (min-width: 1101px)';
export function DesktopPreviews({scene}:{scene:DroneScene|null}){
  const [desktop,setDesktop]=useState(()=>window.matchMedia(DESKTOP_PREVIEW_QUERY).matches);
  const [showCamera,setShowCamera]=useState(true),[showOverhead,setShowOverhead]=useState(true);
  const camera=useRef<HTMLCanvasElement>(null),overhead=useRef<HTMLDivElement>(null);
  useEffect(()=>{const media=window.matchMedia(DESKTOP_PREVIEW_QUERY),change=()=>setDesktop(media.matches);media.addEventListener('change',change);change();return()=>media.removeEventListener('change',change);},[]);
  useEffect(()=>{
    if(!desktop||!scene||!showCamera)return;
    const target=camera.current,context=target?.getContext('2d');
    const copy=()=>{if(context&&target&&scene.payloadCamera.canvas.width){context.drawImage(scene.payloadCamera.canvas,0,0,target.width,target.height);}};
    // Subscribe to the existing sensor; never reparent the CameraPanel canvas.
    const unsubscribe=scene.payloadCamera.subscribe(copy);copy();
    return unsubscribe;
  },[desktop,scene,showCamera]);
  useEffect(()=>{
    if(!desktop||!scene||!showOverhead)return;
    overhead.current?.appendChild(scene.overheadPreview.canvas);scene.overheadPreview.setEnabled(true);
    return()=>{scene.overheadPreview.setEnabled(false);scene.overheadPreview.canvas.remove();};
  },[desktop,scene,showOverhead]);
  if(!desktop||!scene)return null;
  return <section className="desktop-previews" aria-label="飛行雙預覽">
    <div className="desktop-preview-switches" aria-label="預覽開關">
      <button aria-pressed={showCamera} aria-controls="desktop-camera-preview" onClick={()=>setShowCamera(v=>!v)}>機載相機 {showCamera?'開':'關'}</button>
      <button aria-pressed={showOverhead} aria-controls="desktop-overhead-preview" onClick={()=>setShowOverhead(v=>!v)}>俯視預覽 {showOverhead?'開':'關'}</button>
    </div>
    {showCamera&&<figure id="desktop-camera-preview"><figcaption>機載相機</figcaption><canvas ref={camera} width={320} height={180} aria-label="機載相機預覽"/></figure>}
    {showOverhead&&<figure id="desktop-overhead-preview"><figcaption>正上方俯視 · 北 ↑</figcaption><div ref={overhead}/></figure>}
  </section>;
}
