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
import type { RacingParams } from '../src/challenges/racing';
it('race HUD exposes telemetry, progress, takeover and complete score/best details',async()=>{
  const dom=new JSDOM('<div id="root"/>',{url:'http://localhost'}),original={window:globalThis.window,document:globalThis.document};Object.assign(globalThis,{window:dom.window,document:dom.window.document,IS_REACT_ACT_ENVIRONMENT:true});
  const c=createChallengeCatalog(),model=new FlightModel(),manager=new ChallengeManager(c.registry,c.rules,c.scoring,new MemoryResultRepository(),{initialize:d=>model.reset(d.spawn),stop(){}});
  manager.setSceneProvider({async load(){return{dispose(){}};}});const root=createRoot(document.getElementById('root')!);let open=true,takeovers=0;
  const render=()=>root.render(createElement(ChallengePanel,{manager,open,onClose:()=>{open=false;render();},onOpen:()=>{open=true;render();},onExample(){},canTakeover:true,onTakeover:()=>{takeovers++;}}));
  const click=(text:string)=>act(async()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent===text)!;assert.ok(b,text);b.click();});
  try{
    await act(render);assert.equal(document.querySelectorAll('.challenge-cards button').length,3);assert.match(document.body.textContent!,/Waypoint Racing/);
    await act(async()=>{document.querySelector<HTMLButtonElement>('.challenge-cards button')!.click();});assert.equal(document.querySelectorAll('.race-waypoints li').length,5);assert.match(document.body.textContent!,/模式倍率/);
    await click('開始挑戰（3 秒倒數）');await act(()=>{for(let i=0;i<30;i++)manager.update(.1,model.state,'MANUAL');});
    for(const label of ['時間','偏離加時','目前航點','下一航點','飛行模式','控制來源','預估成績','模式倍率'])assert.match(document.querySelector('.race-readout')!.textContent!,new RegExp(label));
    await click('手動接管');assert.equal(takeovers,1);
    const params=manager.snapshot.definition!.objectives[0].params as unknown as RacingParams;
    await act(()=>{model.state.mode='flying';for(const w of params.waypoints){model.state.position={...w.position};manager.update(.1,model.state,'AI_MISSION');}});
    await click('關卡詳情');assert.equal(manager.snapshot.status,'COMPLETED');assert.match(document.body.textContent!,/刷新此控制來源的最佳紀錄/);assert.match(document.body.textContent!,/最終等效時間/);assert.match(document.body.textContent!,/模式加成/);assert.match(document.body.textContent!,/AI_MISSION/);
    assert.equal(document.querySelectorAll('.race-waypoints [data-state=completed]').length,5);
  }finally{await act(()=>{root.unmount();manager.dispose();});Object.assign(globalThis,original);dom.window.close();}
});
