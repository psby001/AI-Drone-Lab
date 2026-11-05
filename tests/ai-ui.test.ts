import * as Blockly from 'blockly';
import {workspaceToMission} from '../src/blockly/missionBlocks';
import {prepareBlocklyDom} from './fixtures/blockly-dom';
import { it } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { act, createElement, useState } from 'react';
import { MissionPanel } from '../src/components/MissionPanel';
import { MissionRunner } from '../src/missions/MissionRunner';
import { FlightModel } from '../src/core/flight';
import { PRESETS } from '../src/missions/presets';
import { PROMPT_EXAMPLES } from '../src/ai/contracts';
import { exampleMission } from './fixtures/ai';
const success=()=>Response.json({status:'ready',message:'任務已轉換，請先預覽。',questions:[],mission:exampleMission});
async function setup(){
  const dom=new JSDOM('<div id="root"></div>',{url:'http://localhost',pretendToBeVisual:true});
  Object.assign(globalThis,{window:dom.window,document:dom.window.document,HTMLElement:dom.window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true,requestAnimationFrame:(cb:()=>void)=>{cb();return 1;}});
  dom.window.HTMLElement.prototype.scrollIntoView=()=>{};
  prepareBlocklyDom(dom.window as unknown as Window & typeof globalThis);
  const {createRoot}=await import('react-dom/client');
  const model=new FlightModel('calm'),runner=new MissionRunner(model);runner.load(PRESETS[0].mission);
  let refresh=()=>{};
  function Harness(){
    const [snapshot,setSnapshot]=useState(()=>structuredClone(runner.snapshot)),[prompt,setPrompt]=useState(''),[open,setOpen]=useState(true);
    refresh=()=>setSnapshot(structuredClone(runner.snapshot));
    return createElement(MissionPanel,{runner,snapshot,aiOpen:open,onAiOpen:setOpen,aiPrompt:prompt,onAiPrompt:setPrompt,onAction:(action)=>{action();refresh();},onClose(){}});
  }
  const root=createRoot(document.getElementById('root')!);await act(()=>root.render(createElement(Harness)));
  const click=async(text:string)=>act(async()=>{const button=Array.from(document.querySelectorAll('button')).find(b=>b.textContent===text)!;assert.ok(button,text);assert.equal(button.disabled,false,text);button.click();await new Promise(resolve=>setTimeout(resolve,0));});
  const close=async()=>{await act(()=>root.unmount());dom.window.close();};
  return {model,runner,refresh,click,close};
}
it('Chinese AI preview requires explicit start, supports JSON editing and rerunning through the original runner',async()=>{
  const oldFetch=globalThis.fetch;let calls=0;
  globalThis.fetch=(async(url,options)=>{calls++;assert.equal(url,'/api/ai/mission');assert.equal(JSON.parse(options!.body as string).prompt,PROMPT_EXAMPLES[0]);return success();}) as typeof fetch;
  const f=await setup();
  try{
    await f.click('轉向與前進');assert.equal((document.getElementById('ai-prompt') as HTMLTextAreaElement).value,PROMPT_EXAMPLES[0]);
    await f.click('產生任務');assert.match(document.querySelector('.ai-answer')!.textContent!,/尚未執行/);
    assert.equal(document.querySelector('.ai-preview pre'),null);assert.equal(document.getElementById('mission-json'),null);
    assert.equal(f.model.state.mode,'grounded');await f.click('轉成積木編輯');assert.deepEqual(workspaceToMission(Blockly.getMainWorkspace()),exampleMission);assert.equal(f.runner.ownsControl,false);
    await f.click('▶ 執行積木');assert.equal(f.runner.snapshot.status,'running');assert.equal((document.getElementById('ai-prompt') as HTMLTextAreaElement).disabled,true);
    await act(()=>{for(let i=0;i<21600&&f.runner.ownsControl;i++)f.runner.update(1/120);f.refresh();});
    assert.equal(f.runner.snapshot.status,'completed');assert.ok(Math.abs(f.model.state.position.east-5)<0.4);assert.ok(Math.abs(f.model.state.position.north-10)<0.4);
    await f.click('▶ 執行積木');assert.equal(f.runner.snapshot.status,'running');assert.equal(calls,1);
  }finally{await f.close();globalThis.fetch=oldFetch;}
});
it('API failure retains student input and the current task, and fallback uses no API',async()=>{
  const oldFetch=globalThis.fetch;let calls=0;
  globalThis.fetch=(async()=>{calls++;return Response.json({error:{code:'NOT_CONFIGURED',message:'AI 尚未設定金鑰，請使用預設任務。'}},{status:503});}) as typeof fetch;
  const f=await setup();
  try{
    await f.click('側向平移');const source=workspaceToMission(Blockly.getMainWorkspace());
    await f.click('產生任務');assert.match(document.querySelector('.ai-error')!.textContent!,/尚未設定金鑰/);
    assert.equal((document.getElementById('ai-prompt') as HTMLTextAreaElement).value,PROMPT_EXAMPLES[1]);
    assert.deepEqual(workspaceToMission(Blockly.getMainWorkspace()),source);assert.equal(document.querySelector('.ai-preview'),null);
    await f.click('使用起降預設');await f.click('▶ 執行積木');assert.equal(f.runner.snapshot.status,'running');assert.equal(calls,1);
  }finally{await f.close();globalThis.fetch=oldFetch;}
});
it('clarification and rejected or invalid JSON responses never become executable tasks',async()=>{
  const oldFetch=globalThis.fetch;const f=await setup();
  try{
    await f.click('轉向與前進');
    for(const value of [
      {status:'clarification',message:'右移還是右轉？',questions:['請補充距離或角度。'],mission:null},
      {status:'rejected',message:'超過高度限制。',questions:[],mission:null},
      {status:'ready',message:'飛行任務',questions:[],mission:{commands:[{action:'takeoff',altitude:100},{action:'land'}]}},
    ]){
      globalThis.fetch=(async()=>Response.json(value)) as typeof fetch;await f.click('產生任務');
      assert.equal(document.querySelector('.ai-preview'),null);assert.equal(f.runner.ownsControl,false);assert.equal(f.model.state.mode,'grounded');
      assert.ok(document.querySelector('.ai-answer')||document.querySelector('.ai-error'));
    }
  }finally{await f.close();globalThis.fetch=oldFetch;}
});
it('cancels obsolete requests and discards late answers after the prompt changes',async()=>{
  const oldFetch=globalThis.fetch;let resolve!:(response:Response)=>void,signal:AbortSignal|undefined;
  globalThis.fetch=(async(_url,options)=>{signal=options!.signal as AbortSignal;return new Promise<Response>(done=>{resolve=done;});}) as typeof fetch;
  const f=await setup();
  try{
    await f.click('轉向與前進');await f.click('產生任務');assert.match(document.querySelector('.ai-actions')!.textContent!,/解析中/);
    await f.click('側向平移');assert.equal(signal!.aborted,true);
    await act(async()=>{resolve(success());await new Promise(done=>setTimeout(done,0));});
    assert.equal(document.querySelector('.ai-preview'),null);assert.equal((document.getElementById('ai-prompt') as HTMLTextAreaElement).value,PROMPT_EXAMPLES[1]);
    assert.equal(f.runner.ownsControl,false);
  }finally{await f.close();globalThis.fetch=oldFetch;}
});
it('switches between ChatGPT and API Key explicitly and sends only the selected source',async()=>{
  const oldFetch=globalThis.fetch;const sources:unknown[]=[];
  globalThis.fetch=(async(url,options)=>{
    if(String(url).endsWith('/status'))return Response.json({enabled:true,activeId:'account',accounts:[{id:'account',label:'本機使用者',connected:true,sharing:true}],login:{state:'completed',message:'使用 ChatGPT 方案'}});
    if(String(url).endsWith('/models'))return Response.json({models:[{slug:'account-model',displayName:'帳號可用模型'}]});
    sources.push(JSON.parse(options!.body as string));return success();
  }) as typeof fetch;
  const f=await setup();
  try{
    const select=document.querySelector<HTMLSelectElement>('select[aria-label="AI 來源"]')!;
    await act(async()=>{select.value='chatgpt';select.dispatchEvent(new window.Event('change',{bubbles:true}));await new Promise(done=>setTimeout(done,0));});
    assert.match(document.querySelector('.chatgpt-connection')!.textContent!,/帳號可用模型/);
    await f.click('轉向與前進');await f.click('產生任務');assert.deepEqual(sources[0],{prompt:PROMPT_EXAMPLES[0],provider:'chatgpt',model:'account-model'});
    assert.equal(f.runner.ownsControl,false);
    await act(()=>{select.value='api_key';select.dispatchEvent(new window.Event('change',{bubbles:true}));});
    assert.equal(document.querySelector('.ai-preview'),null);await f.click('產生任務');assert.deepEqual(sources[1],{prompt:PROMPT_EXAMPLES[0]});
  }finally{await f.close();globalThis.fetch=oldFetch;}
});
it('recovers ChatGPT status after an HTML fallback without clearing student input',async()=>{
  const oldFetch=globalThis.fetch;let restored=false;
  globalThis.fetch=(async()=>restored?Response.json({enabled:true,activeId:null,accounts:[],login:{state:'idle',message:'尚未登入 ChatGPT'}}):new Response('<!doctype html><html>old server</html>',{headers:{'Content-Type':'text/html'}})) as typeof fetch;
  const f=await setup();
  try{
    await f.click('轉向與前進');
    await act(async()=>{const select=document.querySelector<HTMLSelectElement>('select[aria-label="AI 來源"]')!;select.value='chatgpt';select.dispatchEvent(new window.Event('change',{bubbles:true}));await new Promise(done=>setTimeout(done,0));});
    assert.match(document.querySelector('.chatgpt-connection [role="alert"]')!.textContent!,/pnpm dev/);
    assert.equal((document.getElementById('ai-prompt') as HTMLTextAreaElement).value,PROMPT_EXAMPLES[0]);
    restored=true;await f.click('重新整理連線');
    assert.equal(document.querySelector('.chatgpt-connection [role="alert"]'),null);
    assert.match(document.querySelector('.chatgpt-connection')!.textContent!,/尚未登入 ChatGPT/);
    assert.equal(f.runner.ownsControl,false);
  }finally{await f.close();globalThis.fetch=oldFetch;}
});
it('previews the full parallel circle and executes it as one shared-physics phase',async()=>{
  const f=await setup();try{
    await act(()=>{const select=document.querySelector('option[value="parallel-circle"]')!.parentElement as HTMLSelectElement;select.value='parallel-circle';select.dispatchEvent(new window.Event('change',{bubbles:true}));});
    assert.equal(workspaceToMission(Blockly.getMainWorkspace()).commands[1].action,'parallel');
    await f.click('▶ 執行積木');await act(()=>{for(let i=0;i<21600&&f.runner.ownsControl;i++)f.runner.update(1/120);f.refresh();});
    assert.equal(f.runner.snapshot.status,'completed');assert.equal(f.runner.snapshot.completed.length,3);
  }finally{await f.close();}
});

it('API model picker loads key-specific models and sends the selected model',async()=>{
  const oldFetch=globalThis.fetch;let chosen='';
  globalThis.fetch=(async(url,options)=>{
    if(url==='/api/ai/models')return Response.json({models:['test-text-model']});
    const body=JSON.parse(options!.body as string);chosen=body.model;assert.equal(body.provider,'api_key');return success();
  }) as typeof fetch;
  const f=await setup();
  try{
    await f.click('更新 API 模型清單');
    const select=document.querySelector('[aria-label="API 模型"]') as HTMLSelectElement;
    await act(()=>{select.value='test-text-model';select.dispatchEvent(new window.Event('change',{bubbles:true}));});
    await f.click('轉向與前進');await f.click('產生任務');assert.equal(chosen,'test-text-model');assert.ok(document.querySelector('.ai-preview'));
  }finally{await f.close();globalThis.fetch=oldFetch;}
});
