import { it } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { act,createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { ChallengePanel } from '../src/components/ChallengePanel';
import { AiMissionComposer } from '../src/components/AiMissionComposer';
import { createChallengeCatalog } from '../src/challenges/catalog';
import { ChallengeManager } from '../src/challenges/ChallengeManager';
import { MemoryResultRepository } from '../src/challenges/repository';
import { FlightModel } from '../src/core/flight';
import { PHOTO_HUNT,HUNT_TARGETS } from '../src/challenges/photoHunt/definition';
import { PhotoAlbum } from '../src/challenges/photoHunt/PhotoAlbum';
import { publicHuntContext } from '../src/challenges/photoHunt/publicContext';
import { acceptHuntPhoto,huntCaptureToken } from '../src/challenges/photoHunt/bridge';
import type { CameraSnapshot,ObjectAnnotation } from '../src/groundTruth/types';

it('photo HUD, manual capture, feedback, photos, settlement, same/new seeds and menu reuse the shared UI',async()=>{
  const dom=new JSDOM('<div id="root"/>',{url:'http://localhost'}),old={window:globalThis.window,document:globalThis.document};Object.assign(globalThis,{window:dom.window,document:dom.window.document,IS_REACT_ACT_ENVIRONMENT:true});
  const c=createChallengeCatalog(),model=new FlightModel(),repository=new MemoryResultRepository(),album=new PhotoAlbum(),manager=new ChallengeManager(c.registry,c.rules,c.scoring,repository,{initialize:d=>model.reset(d.spawn),stop(){}});manager.setSceneProvider({async load(){return{dispose(){}};}});const root=createRoot(document.getElementById('root')!);let open=true;
  const snapshot={photo_id:'ui-photo',timestamp:1234,scene_id:PHOTO_HUNT.id,image_data:new Blob(['image'],{type:'image/png'}),object_annotations:HUNT_TARGETS.map(t=>({object_id:t.object_id,class_name:t.class_name,is_in_frame:true,is_valid_annotation:true,bounding_box_2d:{x:10,y:10,width:100,height:100},visibility_ratio:1,in_frame_ratio:1,visible_area_ratio:.2,normalized_center:{x:.5,y:.5}} as ObjectAnnotation))} as CameraSnapshot;
  const render=()=>root.render(createElement(ChallengePanel,{manager,open,photoAlbum:album,onPhoto:async()=>{acceptHuntPhoto(manager,snapshot,huntCaptureToken(manager));await album.put(snapshot.photo_id,snapshot.image_data);},onClose:()=>{open=false;render();},onOpen:()=>{open=true;render();},onExample(){}}));
  const click=(label:string)=>act(async()=>{const button=[...document.querySelectorAll('button')].find(b=>b.textContent===label);assert.ok(button,label);assert.equal(button.disabled,false);button.click();});
  try{
    await act(render);assert.equal(document.querySelectorAll('.challenge-cards button').length,3);await act(()=>manager.select(PHOTO_HUNT.id));assert.match(document.body.textContent!,/完整入鏡 40 分/);assert.ok(!document.body.textContent!.includes('spawn_candidates'));await click('開始挑戰（3 秒倒數）');await act(()=>{for(let i=0;i<30;i++)manager.update(.1,model.state,'MANUAL');model.arm();});await click('📷 拍照評分');await act(()=>manager.update(.1,model.state,'MANUAL'));assert.equal(manager.snapshot.status,'COMPLETED');await click('關卡詳情');assert.match(document.querySelector('[aria-label="成績明細"]')!.textContent!,/100 分/);assert.equal(document.querySelectorAll('[aria-label="最佳照片"] img').length,3);assert.match(document.body.textContent!,/拍攝成功/);assert.match(document.querySelector('[aria-label="最新照片評分"]')!.textContent!,/入鏡 40.0/);assert.ok(!document.body.textContent!.includes('bounding_box_2d'));
    await click('重新挑戰');assert.equal(manager.snapshot.definition?.scene.seed,985);assert.equal(manager.snapshot.metrics.treasures.found,0);await click('新 Seed 重新配置');assert.notEqual(manager.snapshot.definition?.scene.seed,985);await click('返回主選單／自由飛行');assert.equal(manager.snapshot.status,'IDLE');assert.equal(document.querySelectorAll('.challenge-cards button').length,3);
  }finally{await act(()=>{root.unmount();manager.dispose();});Object.assign(globalThis,old);dom.window.close();}
});
it('AI requests include only whitelisted public search regions and the student prompt',async()=>{
  const dom=new JSDOM('<div id="root"/>',{url:'http://localhost'}),old={window:globalThis.window,document:globalThis.document,fetch:globalThis.fetch};Object.assign(globalThis,{window:dom.window,document:dom.window.document,IS_REACT_ACT_ENVIRONMENT:true});const root=createRoot(document.getElementById('root')!);let sent='';globalThis.fetch=(async(_url,options)=>{sent=JSON.parse(options!.body as string).prompt;return Response.json({status:'clarification',message:'請確認搜尋順序',questions:['要依序搜尋嗎？'],mission:null});}) as typeof fetch;
  try{const d=structuredClone(PHOTO_HUNT);d.metadata.secret='do not send';const context=publicHuntContext(d);await act(()=>root.render(createElement(AiMissionComposer,{prompt:'起飛到 12 公尺，去停車場拍照後返航。',onPromptChange(){},disabled:false,onUse(){},onEdit(){},publicContext:context})));await act(async()=>{[...document.querySelectorAll('button')].find(b=>b.textContent==='產生任務')!.click();});assert.match(sent,/停車場 goto_local x=-16,y=29/);assert.match(sent,/起飛到 12 公尺/);for(const hidden of ['spawn_candidates','hunt-red-car','world_position','do not send'])assert.ok(!sent.includes(hidden),hidden);assert.ok(sent.length<=1000);assert.equal(publicHuntContext(null),'');}finally{await act(()=>root.unmount());Object.assign(globalThis,old);dom.window.close();}
});
