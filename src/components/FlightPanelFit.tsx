import { useLayoutEffect,useRef,type ReactNode } from 'react';
import { mobileInterface,subscribeInterfaceLayout } from '../interfaceLayout';

/** Fit the complete desktop instrument panel; mobile controls keep their native layout. */
export function FlightPanelFit({children}:{children:ReactNode}){
  const ref=useRef<HTMLDivElement>(null);
  useLayoutEffect(()=>{
    const element=ref.current,parent=element?.parentElement;if(!element||!parent)return;
    const media=window.matchMedia('(max-width:700px),(max-height:600px) and (max-width:1100px)');
    let frame=0,disposed=false,scale=1;
    const measure=()=>{
      frame=0;if(disposed)return;
      if(mobileInterface(media.matches)){scale=1;element.style.removeProperty('transform');element.style.removeProperty('width');return;}
      const available=parent.clientHeight,natural=element.scrollHeight;
      if(!available||!natural)return;
      const next=Math.min(1,(available-2)/natural);
      if(Math.abs(next-scale)<.003)return;
      scale=next;element.style.width=`${100/scale}%`;element.style.transform=`scale(${scale})`;
    };
    const schedule=()=>{if(!frame)frame=requestAnimationFrame(measure);};
    const observer=new ResizeObserver(schedule);observer.observe(parent);observer.observe(element);
    const unsubscribe=subscribeInterfaceLayout(schedule);media.addEventListener('change',schedule);window.addEventListener('resize',schedule);schedule();
    return()=>{disposed=true;cancelAnimationFrame(frame);observer.disconnect();unsubscribe();media.removeEventListener('change',schedule);window.removeEventListener('resize',schedule);};
  },[]);
  return <div className="flight-panel-fit" ref={ref}>{children}</div>;
}
