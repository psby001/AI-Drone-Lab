import { it } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { act,createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { PageFullscreenButton } from '../src/components/PageFullscreenButton';
import { CameraPanel } from '../src/components/CameraPanel';
import { CameraController } from '../src/camera/CameraController';
function fixture(){
  const dom=new JSDOM('<div id="root"/>',{url:'https://drone.example.test'}),previous={window:globalThis.window,document:globalThis.document};Object.assign(globalThis,{window:dom.window,document:dom.window.document,IS_REACT_ACT_ENVIRONMENT:true});
  const stack:Element[]=[];let exits=0,requests=0;
  Object.defineProperty(document,'fullscreenElement',{get:()=>stack.at(-1)??null,configurable:true});
  dom.window.HTMLElement.prototype.requestFullscreen=async function(){requests++;stack.push(this);document.dispatchEvent(new dom.window.Event('fullscreenchange'));};
  document.exitFullscreen=async()=>{exits++;stack.pop();document.dispatchEvent(new dom.window.Event('fullscreenchange'));};
  const root=createRoot(document.getElementById('root')!);
  const click=(selector:string)=>act(async()=>{const button=document.querySelector<HTMLButtonElement>(selector);assert.ok(button,selector);button.click();});
  return{dom,root,stack,click,counts:()=>({exits,requests}),async close(){await act(()=>root.unmount());Object.assign(globalThis,previous);dom.window.close();}};
}
it('page fullscreen requests the document root and synchronizes button state on browser exit',async()=>{
  const f=fixture();try{await act(()=>f.root.render(createElement(PageFullscreenButton)));await f.click('.page-fullscreen-button');assert.equal(document.fullscreenElement,document.documentElement);assert.equal(document.querySelector('button')!.getAttribute('aria-pressed'),'true');await f.click('.page-fullscreen-button');assert.equal(document.fullscreenElement,null);assert.equal(f.counts().exits,1);
    await f.click('.page-fullscreen-button');await act(()=>{f.stack.length=0;document.dispatchEvent(new f.dom.window.Event('fullscreenchange'));});assert.equal(document.querySelector('button')!.getAttribute('aria-pressed'),'false');
  }finally{await f.close();}
});
it('denied and unsupported fullscreen show a clear message without falsely claiming fullscreen',async()=>{
  const f=fixture();try{document.documentElement.requestFullscreen=async()=>{throw new Error('denied');};await act(()=>f.root.render(createElement(PageFullscreenButton)));await f.click('.page-fullscreen-button');assert.match(document.querySelector('[role=status]')!.textContent!,/未允許/);assert.equal(document.querySelector('button')!.getAttribute('aria-pressed'),'false');await f.click('[aria-label="關閉全螢幕提示"]');assert.equal(document.querySelector('[role=status]'),null);
    Object.defineProperty(document.documentElement,'requestFullscreen',{value:undefined,configurable:true});await f.click('.page-fullscreen-button');assert.match(document.querySelector('[role=status]')!.textContent!,/不支援/);
  }finally{await f.close();}
});
it('camera fullscreen can open inside page fullscreen and exit back to the page',async()=>{
  const f=fixture(),controller=new CameraController();controller.setEnabled(true);
  try{await act(()=>f.root.render(createElement('div',{},createElement(PageFullscreenButton),createElement(CameraPanel,{controller,provider:null,locked:false,heading:0}))));await f.click('.page-fullscreen-button');assert.equal(document.fullscreenElement,document.documentElement);await f.click('.desktop-camera-fullscreen');assert.equal(document.fullscreenElement,document.querySelector('.payload-camera'));assert.equal(f.counts().exits,0);await f.click('.desktop-camera-fullscreen');assert.equal(document.fullscreenElement,document.documentElement);assert.equal(document.querySelector('.page-fullscreen-button')!.getAttribute('aria-pressed'),'true');
  }finally{await f.close();}
});
