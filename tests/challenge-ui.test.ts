import { it } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { act,createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { ChallengePanel } from '../src/components/ChallengePanel';
import { createChallengeCatalog } from './fixtures/challenge-catalog';
import { ChallengeManager } from '../src/challenges/ChallengeManager';
import { MemoryResultRepository } from '../src/challenges/repository';
import { FlightModel } from '../src/core/flight';
it('challenge menu loads, counts down, pauses, displays settlement, retries and returns to the menu',async()=>{
  const dom=new JSDOM('<div id="root"/>',{url:'http://localhost'}),original={window:globalThis.window,document:globalThis.document};Object.assign(globalThis,{window:dom.window,document:dom.window.document,IS_REACT_ACT_ENVIRONMENT:true});
  const c=createChallengeCatalog(),model=new FlightModel(),manager=new ChallengeManager(c.registry,c.rules,c.scoring,new MemoryResultRepository(),{initialize:d=>model.reset(d.spawn),stop(){}});
  manager.setSceneProvider({async load(){return{dispose(){}};}});const root=createRoot(document.getElementById('root')!);let open=true,examples=0;
  const render=()=>root.render(createElement(ChallengePanel,{manager,open,onClose:()=>{open=false;render();},onOpen:()=>{open=true;render();},onExample:()=>{examples++;}}));
  const click=(text:string)=>act(async()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent===text)!;assert.ok(b,text);b.click();});
  try{
    await act(render);assert.equal(document.querySelectorAll('.challenge-cards button').length,2);
    await act(async()=>{document.querySelector<HTMLButtonElement>('.challenge-cards button')!.click();});assert.match(document.body.textContent!,/準備就緒/);
    await click('載入示範積木任務');assert.equal(examples,1);await click('開始挑戰（3 秒倒數）');assert.ok(document.querySelector('.challenge-hud'));
    const disclosure=()=>document.querySelector<HTMLButtonElement>('[aria-controls="challenge-hud-details"]')!;
    assert.equal(disclosure().getAttribute('aria-expanded'),'false');
    await act(()=>disclosure().click());assert.equal(disclosure().getAttribute('aria-expanded'),'true');assert.ok(document.querySelector('.challenge-hud.hud-expanded'));
    await act(()=>disclosure().click());assert.equal(disclosure().getAttribute('aria-expanded'),'false');
    await click('暫停');assert.match(document.body.textContent!,/已暫停/);await click('繼續');
    await act(()=>{for(let i=0;i<30;i++)manager.update(.1,model.state,'MANUAL');});assert.match(document.body.textContent!,/挑戰中/);
    await click('關卡詳情');await click('中止挑戰');assert.ok(document.querySelector('[aria-label="成績明細"]'));assert.match(document.body.textContent!,/ABORTED/);
    await click('重新挑戰');assert.match(document.body.textContent!,/準備就緒/);await click('返回主選單／自由飛行');assert.equal(manager.snapshot.status,'IDLE');assert.equal(document.querySelectorAll('.challenge-cards button').length,2);
  }finally{await act(()=>{root.unmount();manager.dispose();});Object.assign(globalThis,original);dom.window.close();}
});
