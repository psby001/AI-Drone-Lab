import { it } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { act, createElement, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MissionPanel } from '../src/components/MissionPanel';
import { MissionRunner } from '../src/missions/MissionRunner';
import { PRESETS } from '../src/missions/presets';
import { FlightModel } from '../src/core/flight';
it('mission UI loads a square, locks its editor, pauses/resumes/stops/resets and completes',async()=>{
  const dom=new JSDOM('<div id="root"></div>',{url:'http://localhost'});
  Object.assign(globalThis,{window:dom.window,document:dom.window.document,IS_REACT_ACT_ENVIRONMENT:true});
  const runner=new MissionRunner(new FlightModel());runner.load(PRESETS[0].mission);
  let refresh:()=>void=()=>{};
  function Harness(){const [snapshot,setSnapshot]=useState(()=>structuredClone(runner.snapshot));refresh=()=>setSnapshot(structuredClone(runner.snapshot));return createElement(MissionPanel,{runner,snapshot,onAction:(action)=>{action();refresh();},onClose(){}});}
  const root=createRoot(document.getElementById('root')!);await act(()=>root.render(createElement(Harness)));
  const click=async(text:string)=>act(()=>{const button=Array.from(document.querySelectorAll('button')).find(b=>b.textContent===text)!;assert.ok(button);assert.equal(button.disabled,false);button.click();});
  await act(()=>{const select=document.querySelector('option[value="square"]')!.parentElement as HTMLSelectElement;select.value='square';select.dispatchEvent(new dom.window.Event('change',{bubbles:true}));});
  assert.equal(document.querySelectorAll('.mission-steps li').length,10);assert.match(document.querySelector<HTMLTextAreaElement>('#mission-json')!.value,/repeat/);
  await click('▶ 開始');assert.equal(document.querySelector<HTMLTextAreaElement>('#mission-json')!.disabled,true);assert.equal(document.querySelectorAll('.mission-steps .current').length,1);
  await click('Ⅱ 暫停');assert.equal(runner.snapshot.status,'paused');await click('▷ 繼續');assert.equal(runner.snapshot.status,'running');
  await click('■ 停止');assert.equal(document.querySelector<HTMLTextAreaElement>('#mission-json')!.disabled,false);
  await click('↺ 重置任務與飛機');await click('▶ 開始');
  await act(()=>{for(let i=0;i<120*180&&runner.ownsControl;i++)runner.update(1/120);refresh();});
  assert.match(document.querySelector('.mission-state')!.textContent!,/任務完成/);assert.equal(document.querySelectorAll('.mission-steps .done').length,10);
  await click('↻ 重新執行');assert.equal(runner.snapshot.status,'running');
  await act(()=>root.unmount());dom.window.close();
});
