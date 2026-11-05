import {it} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {act,createElement} from 'react';
import {FlightPanelFit} from '../src/components/FlightPanelFit';
import {setInterfaceLayout} from '../src/interfaceLayout';
it('fits the complete instrument panel to available desktop height and removes scaling in mobile mode',async()=>{
  const dom=new JSDOM('<div id="root"></div>',{url:'http://localhost'});let height=600,resize=()=>{};
  Object.assign(globalThis,{window:dom.window,document:dom.window.document,IS_REACT_ACT_ENVIRONMENT:true,requestAnimationFrame:(fn:()=>void)=>setTimeout(fn,0),cancelAnimationFrame:clearTimeout,ResizeObserver:class{constructor(fn:()=>void){resize=fn;}observe(){}disconnect(){}}});
  dom.window.matchMedia=()=>({matches:false,addEventListener(){},removeEventListener(){}}) as unknown as MediaQueryList;
  Object.defineProperty(dom.window.HTMLElement.prototype,'clientHeight',{get(){return this.tagName==='ASIDE'?height:0;}});
  Object.defineProperty(dom.window.HTMLElement.prototype,'scrollHeight',{get(){return 1000;}});
  const {createRoot}=await import('react-dom/client');const root=createRoot(document.getElementById('root')!);
  const settle=()=>new Promise(resolve=>setTimeout(resolve,15));
  try{await act(async()=>{root.render(createElement('aside',null,createElement(FlightPanelFit,null,createElement('button',null,'重置'))));await settle();});await act(settle);
    const panel=document.querySelector('.flight-panel-fit') as HTMLElement;assert.equal(panel.style.transform,'scale(0.598)');assert.ok(Number.parseFloat(panel.style.width)>100);assert.equal(panel.querySelector('button')!.textContent,'重置');
    await act(async()=>{height=1100;resize();await settle();});assert.equal(panel.style.transform,'scale(1)');
    await act(async()=>{setInterfaceLayout('mobile');await settle();});assert.equal(panel.style.transform,'');assert.equal(panel.style.width,'');
  }finally{await act(()=>root.unmount());setInterfaceLayout('auto');dom.window.close();}
});
