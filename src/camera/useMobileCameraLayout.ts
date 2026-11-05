import { mobileInterface,subscribeInterfaceLayout } from '../interfaceLayout';
import { useLayoutEffect,useState } from 'react';
import { fitCameraPreview,type ScreenRect } from './previewLayout';
const QUERY='(max-width:700px), (max-height:600px) and (max-width:1100px)';
const PROTECTED='.flight-hud,.challenge-hud,.actions,.joystick-group,.physical-controller-status,.mobile-wind-toggle,.camera-switch,.environment-controls,.challenge-panel,.mission-panel,.mission-brief,.mission-result,.gamepad-picker,.gt-panel,.notice,.error';
const rect=(r:DOMRect):ScreenRect=>({x:r.x,y:r.y,width:r.width,height:r.height});
const sameRect=(a:ScreenRect|null,b:ScreenRect|null)=>a===b||!!a&&!!b&&(['x','y','width','height'] as const).every(k=>Math.abs(a[k]-b[k])<.25);
export function useMobileCameraLayout(enabled:boolean,fullscreen:boolean,aspect:number){
  const [layout,setLayout]=useState<{mobile:boolean;rect:ScreenRect|null}>({mobile:false,rect:null});
  useLayoutEffect(()=>{
    if(!enabled||typeof window.matchMedia!=='function')return;
    const media=window.matchMedia(QUERY),observed=new Set<Element>();let frame=0,disposed=false;
    const resize=typeof ResizeObserver==='function'?new ResizeObserver(()=>schedule()):null;
    const measure=()=>{
      if(disposed)return;
      const mobile=mobileInterface(media.matches)&&!fullscreen,workspace=document.querySelector('.manual-app .workspace'),main=document.querySelector('.manual-app main');
      let result:ScreenRect|null=null;
      if(mobile&&workspace){
        const viewport=window.visualViewport,w=rect(workspace.getBoundingClientRect()),left=Math.max(w.x,viewport?.offsetLeft??0),top=Math.max(w.y,viewport?.offsetTop??0);
        const bounds={x:left,y:top,width:Math.min(w.x+w.width,(viewport?.offsetLeft??0)+(viewport?.width??window.innerWidth))-left,height:Math.min(w.y+w.height,(viewport?.offsetTop??0)+(viewport?.height??window.innerHeight))-top};
        const elements=[...document.querySelectorAll(`.manual-app ${PROTECTED.split(',').join(',.manual-app ')}`)];
        const targets=new Set<Element>([workspace,...elements,...(main?[main]:[])]);
        for(const el of observed)if(!targets.has(el)){resize?.unobserve(el);observed.delete(el);}
        for(const el of targets)if(!observed.has(el)){observed.add(el);resize?.observe(el);}
        const obstacles=elements.filter(el=>getComputedStyle(el).visibility!=='hidden').map(el=>rect(el.getBoundingClientRect())).filter(r=>r.width>0&&r.height>0);
        result=fitCameraPreview(bounds,obstacles,aspect);
      }
      setLayout(previous=>previous.mobile===mobile&&sameRect(previous.rect,result)?previous:{mobile,rect:result});
    };
    function schedule(){if(disposed||frame)return;frame=requestAnimationFrame(()=>{frame=0;measure();});}
    const mutations=new MutationObserver(entries=>{if(entries.some(e=>!(e.type==='attributes'&&e.attributeName==='style'&&e.target instanceof Element&&e.target.classList.contains('stick-thumb'))))schedule();}),main=document.querySelector('.manual-app main');
    if(main)mutations.observe(main,{subtree:true,childList:true,attributes:true,attributeFilter:['class','style','hidden']});
    const unsubscribe=subscribeInterfaceLayout(schedule);
    media.addEventListener('change',schedule);window.addEventListener('resize',schedule);window.visualViewport?.addEventListener('resize',schedule);window.visualViewport?.addEventListener('scroll',schedule);
    measure();
    return()=>{unsubscribe();disposed=true;cancelAnimationFrame(frame);resize?.disconnect();mutations.disconnect();media.removeEventListener('change',schedule);window.removeEventListener('resize',schedule);window.visualViewport?.removeEventListener('resize',schedule);window.visualViewport?.removeEventListener('scroll',schedule);};
  },[enabled,fullscreen,aspect]);
  return layout;
}
