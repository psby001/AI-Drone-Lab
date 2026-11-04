import { it } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import * as THREE from 'three';
import { act,createElement } from 'react';
import { OverheadPreview } from '../src/render/OverheadPreview';
import { DesktopPreviews } from '../src/components/DesktopPreviews';
import type { DroneScene } from '../src/render/DroneScene';

function dom(){const d=new JSDOM('<div id="root"></div>');Object.assign(globalThis,{window:d.window,document:d.window.document,IS_REACT_ACT_ENVIRONMENT:true});let copies=0;
  d.window.HTMLCanvasElement.prototype.getContext=function(){return{createImageData:(w:number,h:number)=>({data:new Uint8ClampedArray(w*h*4)}),putImageData(){},drawImage(){copies++;}};} as never;return{d,copies:()=>copies};}
it('overhead view follows the aircraft, keeps north up, throttles and restores shared renderer resources',()=>{
  const {d}=dom();const seen=new WeakSet<THREE.WebGLRenderTarget>();let renders=0,disposed=0;const previous=new THREE.WebGLRenderTarget(1,1);let current:THREE.WebGLRenderTarget|null=previous;
  const renderer={getRenderTarget:()=>current,setRenderTarget:(target:THREE.WebGLRenderTarget|null)=>{current=target;if(target&&target!==previous&&!seen.has(target)){seen.add(target);target.addEventListener('dispose',()=>disposed++);}},render(){renders++;},readRenderTargetPixels(){}} as unknown as THREE.WebGLRenderer;
  const p=new OverheadPreview(renderer,new THREE.Scene());try{
    p.update(new THREE.Vector3(2,5,-3),0);assert.equal(renders,0);p.setEnabled(true);p.update(new THREE.Vector3(2,5,-3),0);p.update(new THREE.Vector3(2,5,-3),1);assert.equal(renders,1);assert.equal(current,previous);
    assert.deepEqual(p.camera.position.toArray(),[2,23,-3]);assert.deepEqual(p.camera.up.toArray(),[0,0,-1]);const direction=p.camera.getWorldDirection(new THREE.Vector3());assert.ok(direction.distanceTo(new THREE.Vector3(0,-1,0))<1e-8);
    p.update(new THREE.Vector3(10,8,-9),100);assert.equal(renders,2);assert.equal(p.camera.position.x,10);p.setEnabled(false);assert.equal(disposed,1);p.update(new THREE.Vector3(),200);assert.equal(renders,2);
  }finally{p.dispose();previous.dispose();d.window.close();}
});
it('desktop mounts both previews without moving the sensor canvas; mobile removes listeners and overhead rendering',async()=>{
  const {d,copies}=dom();let listener:()=>void=()=>{},change:()=>void=()=>{},subscribers=0,enabled=false;
  const media={matches:true,addEventListener:(_type:string,fn:()=>void)=>{change=fn;},removeEventListener(){}};
  d.window.matchMedia=()=>media as unknown as MediaQueryList;
  const sensor=document.createElement('canvas'),owner=document.createElement('div');owner.appendChild(sensor);sensor.width=1280;
  const overhead=document.createElement('canvas');
  const scene={payloadCamera:{canvas:sensor,subscribe:(fn:()=>void)=>{listener=fn;subscribers++;return()=>{subscribers--;};}},overheadPreview:{canvas:overhead,setEnabled:(v:boolean)=>{enabled=v;}}} as unknown as DroneScene;
  const {createRoot}=await import('react-dom/client');const root=createRoot(document.getElementById('root')!);
  try{await act(()=>root.render(createElement(DesktopPreviews,{scene})));assert.equal(document.querySelectorAll('.desktop-previews figure').length,2);assert.equal(subscribers,1);assert.ok(enabled);assert.equal(sensor.parentNode,owner);listener();assert.ok(copies()>=2);
    const buttons=[...document.querySelectorAll('.desktop-preview-switches button')];
    await act(()=>{(buttons[0] as HTMLButtonElement).click();});assert.equal(subscribers,0);assert.equal(enabled,true);assert.equal(document.getElementById('desktop-camera-preview'),null);
    await act(()=>{(buttons[1] as HTMLButtonElement).click();});assert.equal(enabled,false);assert.equal(document.querySelectorAll('.desktop-previews figure').length,0);assert.equal(document.querySelectorAll('.desktop-preview-switches button').length,2);
    await act(()=>{(buttons[0] as HTMLButtonElement).click();});assert.equal(subscribers,1);assert.equal(enabled,false);
    await act(()=>{(buttons[1] as HTMLButtonElement).click();});assert.equal(enabled,true);
    await act(()=>{media.matches=false;change();});assert.equal(document.querySelector('.desktop-previews'),null);assert.equal(subscribers,0);assert.equal(enabled,false);
    await act(()=>{media.matches=true;change();});assert.equal(subscribers,1);assert.equal(enabled,true);
  }finally{await act(()=>root.unmount());assert.equal(subscribers,0);assert.equal(enabled,false);d.window.close();}
});
