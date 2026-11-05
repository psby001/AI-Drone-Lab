import { useLayoutEffect,useSyncExternalStore } from 'react';
export type InterfaceLayout='auto'|'desktop'|'mobile';
const KEY='drone-interface-layout',EVENT='drone-interface-layout-change';
let mode:InterfaceLayout='auto';
try{const saved=window.localStorage.getItem(KEY);if(saved==='mobile'||saved==='desktop')mode=saved;}catch{}
export const getInterfaceLayout=()=>mode;
export function setInterfaceLayout(next:InterfaceLayout){mode=next;try{window.localStorage.setItem(KEY,next);}catch{}window.dispatchEvent(new window.Event(EVENT));}
export const mobileInterface=(automatic:boolean)=>mode==='auto'?automatic:mode==='mobile';
export function subscribeInterfaceLayout(fn:()=>void){window.addEventListener(EVENT,fn);return()=>window.removeEventListener(EVENT,fn);}

/** Re-evaluate only layout dimensions; orientation/accessibility queries stay native. */
export function layoutMedia(query:string,layout:InterfaceLayout,width:number,height:number){
  if(layout==='auto')return query;
  const landscape=width>height;
  const w=layout==='mobile'?(landscape?844:390):Math.max(1280,width);
  const h=layout==='mobile'?(landscape?390:844):Math.max(900,height);
  return query.replace(/\(\s*(min|max)-(width|height)\s*:\s*([\d.]+)px\s*\)/gi,(_all,limit,axis,value)=>{
    const size=axis.toLowerCase()==='width'?w:h,pass=limit.toLowerCase()==='min'?size>=Number(value):size<=Number(value);
    return pass?'(min-width: 0px)':'(max-width: 0px)';
  });
}
export function useInterfaceLayoutStyles(){
  const layout=useSyncExternalStore(subscribeInterfaceLayout,getInterfaceLayout);
  useLayoutEffect(()=>{
    const originals=new Map<CSSMediaRule,string>();let scheduled=0;
    const apply=()=>{
      const visit=(rules:CSSRuleList)=>{for(const rule of Array.from(rules)){
        if(rule.type===4){const media=rule as CSSMediaRule;if(!originals.has(media))originals.set(media,media.conditionText);const query=layoutMedia(originals.get(media)!,layout,window.innerWidth,window.innerHeight);if(media.media.mediaText!==query)media.media.mediaText=query;}
        if('cssRules'in rule)visit((rule as CSSGroupingRule).cssRules);
      }};
      for(const sheet of Array.from(document.styleSheets)){try{visit(sheet.cssRules);}catch{/* Cross-origin stylesheets remain untouched. */}}
    };
    const schedule=()=>{cancelAnimationFrame(scheduled);scheduled=requestAnimationFrame(apply);};
    apply();window.addEventListener('resize',schedule);
    const observer=new MutationObserver(schedule);observer.observe(document.head,{childList:true,subtree:true,characterData:true});
    return()=>{observer.disconnect();window.removeEventListener('resize',schedule);cancelAnimationFrame(scheduled);for(const [rule,query]of originals){try{rule.media.mediaText=query;}catch{}}};
  },[layout]);
}
export function InterfaceLayoutButton({onBeforeChange}:{onBeforeChange?:()=>void}){
  const layout=useSyncExternalStore(subscribeInterfaceLayout,getInterfaceLayout);
  const query='(max-width:700px),(max-height:600px) and (max-width:1100px)';
  const subscribe=(fn:()=>void)=>{const media=window.matchMedia(query);media.addEventListener('change',fn);const unsubscribe=subscribeInterfaceLayout(fn);return()=>{media.removeEventListener('change',fn);unsubscribe();};};
  const mobile=useSyncExternalStore(subscribe,()=>mobileInterface(window.matchMedia(query).matches));
  return <button className="help-button interface-layout-button" aria-label={`介面版面：${mobile?'手機版':'電腦版'}，切換至${mobile?'電腦版':'手機版'}`} title={`目前${layout==='auto'?'自動判斷':'手動選擇'}，按下切換版面`} onClick={()=>{onBeforeChange?.();setInterfaceLayout(mobile?'desktop':'mobile');}}>{mobile?'電腦版':'手機版'}</button>;
}
