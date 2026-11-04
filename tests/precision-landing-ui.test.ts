import { it } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { act,createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { ChallengePanel } from '../src/components/ChallengePanel';
import { createChallengeCatalog } from '../src/challenges/catalog';
import { ChallengeManager } from '../src/challenges/ChallengeManager';
import { MemoryResultRepository } from '../src/challenges/repository';
import { FlightModel } from '../src/core/flight';
it('landing UI exposes scoring before start, physical landing telemetry and retained personal bests',async()=>{
  const dom=new JSDOM('<div id="root"/>',{url:'http://localhost'}),old={window:globalThis.window,document:globalThis.document};Object.assign(globalThis,{window:dom.window,document:dom.window.document,IS_REACT_ACT_ENVIRONMENT:true});
  const c=createChallengeCatalog(),model=new FlightModel(),repo=new MemoryResultRepository(),manager=new ChallengeManager(c.registry,c.rules,c.scoring,repo,{initialize:d=>model.reset(d.spawn),stop(){}});manager.setSceneProvider({async load(){return{dispose(){}};}});
  const root=createRoot(document.getElementById('root')!);let open=true;
  const render=()=>root.render(createElement(ChallengePanel,{manager,open,onClose:()=>{open=false;render();},onOpen:()=>{open=true;render();},onExample(){}}));
  const click=(label:string)=>act(async()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent===label)!;assert.ok(b,label);b.click();});
  try{
    await act(render);assert.equal(document.querySelectorAll('.challenge-cards button').length,3);await act(async()=>{[...document.querySelectorAll<HTMLButtonElement>('.challenge-cards button')].find(b=>b.textContent?.includes('Precision Landing'))!.click();});
    assert.match(document.querySelector('[aria-label="計分規則"]')!.textContent!,/100 分/);assert.match(document.body.textContent!,/x=7、y=8/);assert.match(document.querySelector('[aria-label="個人最佳成績"]')!.textContent!,/尚無完成紀錄/);
    await click('開始挑戰（3 秒倒數）');await act(()=>{for(let i=0;i<30;i++)manager.update(.1,model.state,'MANUAL');model.state.mode='flying';model.state.position={east:4,north:6,up:3};manager.update(.1,model.state,'MANUAL');});
    assert.match(document.querySelector('[aria-label="精準降落資訊"]')!.textContent!,/已達標/);
    await act(()=>{model.state.mode='armed';model.state.position.up=0;for(let i=0;i<6;i++)manager.update(.1,model.state,'MANUAL');});await click('關卡詳情');
    assert.equal(manager.snapshot.status,'COMPLETED');assert.match(document.querySelector('[aria-label="成績明細"]')!.textContent!,/100 分/);assert.match(document.querySelector('[aria-label="個人最佳成績"]')!.textContent!,/MANUAL · 100 分/);
    await click('返回主選單／自由飛行');assert.match(document.querySelector('[aria-label="個人最佳成績"]')!.textContent!,/精準降落 Precision Landing/);
    await act(async()=>{document.querySelector<HTMLButtonElement>('.challenge-cards button')!.click();});assert.match(document.querySelector('[aria-label="計分規則"]')!.textContent!,/等效時間/);assert.match(document.querySelector('[aria-label="個人最佳成績"]')!.textContent!,/尚無完成紀錄/);
  }finally{await act(()=>{root.unmount();manager.dispose();});Object.assign(globalThis,old);dom.window.close();}
});
