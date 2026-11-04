import { it } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { act,createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { CameraPanel } from '../src/components/CameraPanel';
import { CameraController } from '../src/camera/CameraController';
import type { DroneCamera } from '../src/camera/DroneCamera';
it('camera UI changes real controller settings, locks task settings, preserves the preview and media links',async()=>{
  const dom=new JSDOM('<div id="root"></div>',{url:'http://localhost'});
  Object.assign(globalThis,{window:dom.window,document:dom.window.document,IS_REACT_ACT_ENVIRONMENT:true});
  const controller=new CameraController();controller.setEnabled(true);
  let photos=0;
  const media={recording:false,stopping:false,recordingSupported:false,message:'ready',assets:[{id:1,name:'sample.png',url:'blob:sample',kind:'photo' as const,bytes:1024}]};
  const provider={canvas:document.createElement('canvas'),getMetadata:()=>null,getSnapshot:()=>media,subscribeStatus:()=>()=>{},capturePhoto:async()=>{photos++;},deleteAsset(){}} as unknown as DroneCamera;
  const root=createRoot(document.getElementById('root')!);
  const render=async(locked=false)=>act(()=>root.render(createElement(CameraPanel,{controller,provider,locked,heading:90})));
  const click=async(text:string)=>act(async()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent===text)!;assert.ok(b);b.click();});
  try{
    await render();assert.ok(document.querySelector('.payload-image canvas'));
    assert.match(document.body.textContent!,/不支援錄影/);
    const view=document.querySelector('select')!;
    await act(()=>{view.value='nadir';view.dispatchEvent(new dom.window.Event('change',{bubbles:true}));});assert.equal(controller.snapshot.pitch,-90);
    await click('放大');assert.equal(controller.snapshot.fov,60);
    await click('手機低畫質（640×360／10FPS）');assert.equal(controller.snapshot.width,640);assert.equal(controller.snapshot.fps,10);
    await click('拍照');assert.equal(photos,1);assert.equal(document.querySelector('a')!.download,'sample.png');
    await click('放大視窗');assert.ok(document.querySelector('.payload-camera.expanded'));
    await render(true);assert.equal(document.querySelector('fieldset')!.disabled,true);
    assert.ok(document.querySelector('.payload-image canvas'));await click('✕');assert.equal(document.querySelector('.payload-camera'),null);
  }finally{await act(()=>root.unmount());dom.window.close();}
});
