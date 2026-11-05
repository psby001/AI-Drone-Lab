import { it } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { act,createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { MissionResultNotice } from '../src/components/MissionResultNotice';
import type { MissionStatus } from '../src/missions/types';

it('completion notice expires, stays dismissed when opening the editor, and returns for a new run',async t=>{
  const dom=new JSDOM('<div id="root"></div>');
  Object.assign(globalThis,{window:dom.window,document:dom.window.document,IS_REACT_ACT_ENVIRONMENT:true});
  t.mock.timers.enable({apis:['setTimeout']});
  const root=createRoot(document.getElementById('root')!);
  const render=(status:MissionStatus,hidden=false)=>act(()=>root.render(createElement(MissionResultNotice,{status,message:'test',hidden,collision:false,onAction(){}})));
  try {
    await render('completed');assert.ok(document.querySelector('.mission-result'));
    await act(()=>t.mock.timers.tick(4999));assert.ok(document.querySelector('.mission-result'));
    await act(()=>t.mock.timers.tick(1));assert.equal(document.querySelector('.mission-result'),null);
    await render('completed',true);await render('completed');assert.equal(document.querySelector('.mission-result'),null);
    await render('running');await render('completed');assert.ok(document.querySelector('.mission-result'));
    await act(()=>document.querySelector<HTMLButtonElement>('[aria-label="關閉任務通知"]')!.click());
    assert.equal(document.querySelector('.mission-result'),null);
  } finally {await act(()=>root.unmount());t.mock.timers.reset();dom.window.close();}
});

it('collision failure keeps its reset action and can be dismissed without resetting the mission',async()=>{
  const dom=new JSDOM('<div id="root"></div>');
  Object.assign(globalThis,{window:dom.window,document:dom.window.document,IS_REACT_ACT_ENVIRONMENT:true});
  const root=createRoot(document.getElementById('root')!);let resets=0;
  try {
    await act(()=>root.render(createElement(MissionResultNotice,{status:'failed',message:'碰撞',hidden:false,collision:true,onAction(){resets++;}})));
    const buttons=document.querySelectorAll('button');assert.equal(buttons[0].textContent,'重置');
    await act(()=>buttons[0].click());assert.equal(resets,1);
    await act(()=>buttons[1].click());assert.equal(document.querySelector('.mission-result'),null);assert.equal(resets,1);
  } finally {await act(()=>root.unmount());dom.window.close();}
});
