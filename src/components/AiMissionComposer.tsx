import { useCallback, useEffect, useRef, useState } from 'react';
import { AI_LIMITS as A, PROMPT_EXAMPLES, type AiResult } from '../ai/contracts';
import { AiClientError, generateMission } from '../ai/client';
import { validateMission } from '../missions/validate';

import { PRESETS } from '../missions/presets';
import { ApiModelPicker } from './ApiModelPicker';
import { ChatGptConnection } from './ChatGptConnection';
import type { AiProvider } from '../ai/contracts';
interface Props {
  prompt:string;onPromptChange:(value:string)=>void;disabled:boolean;
  onUse:(json:string,start:boolean)=>void;onEdit:()=>void;
  publicContext?:string;
}
export function AiMissionComposer({prompt,onPromptChange,disabled,onUse,onEdit,publicContext=''}:Props){
  const promptLimit=A.maxInputLength-(publicContext?publicContext.length+8:0);
  const [pending,setPending]=useState(false),[result,setResult]=useState<AiResult|null>(null);
  const [error,setError]=useState(''),[details,setDetails]=useState<string[]>([]);
  const request=useRef<AbortController|null>(null),generation=useRef(0);
  const [provider,setProvider]=useState<AiProvider>(()=>{try{return window.sessionStorage.getItem('drone-ai-provider')==='chatgpt'?'chatgpt':'api_key';}catch{return'api_key';}});
  const [apiModel,setApiModel]=useState('');
  const apiModelChange=useCallback((model:string)=>{generation.current++;request.current?.abort();request.current=null;setPending(false);setResult(null);setApiModel(model);},[]);
  const [chatGptModel,setChatGptModel]=useState(''),[chatGptReady,setChatGptReady]=useState(false);
  const connectionChange=useCallback((model:string,ready:boolean)=>{
    generation.current++;request.current?.abort();request.current=null;setPending(false);setResult(null);setChatGptModel(model);setChatGptReady(ready);
  },[]);
  const cancel=()=>{generation.current++;request.current?.abort();request.current=null;setPending(false);};
  useEffect(()=>()=>{generation.current++;request.current?.abort();},[]);
  useEffect(()=>{if(disabled){generation.current++;request.current?.abort();request.current=null;setPending(false);}},[disabled]);
  useEffect(()=>{generation.current++;request.current?.abort();request.current=null;setPending(false);setResult(null);},[publicContext]);
  const editPrompt=(value:string)=>{cancel();setResult(null);setError('');setDetails([]);onPromptChange(value);};
  const generate=async()=>{
    if(disabled||request.current||!prompt.trim()||prompt.length>promptLimit||(provider==='chatgpt'&&!chatGptReady))return;
    const controller=new AbortController(),id=++generation.current;
    request.current=controller;setPending(true);setResult(null);setError('');setDetails([]);
    try{const parsed=await generateMission(publicContext?`${publicContext}\n學生任務：\n${prompt}`:prompt,controller.signal,provider==='chatgpt'?{provider,model:chatGptModel}:apiModel?{provider:'api_key',model:apiModel}:undefined);if(generation.current===id){setResult(parsed);if(parsed.status==='ready')onUse(JSON.stringify(parsed.mission),false);}}
    catch(error){if(generation.current===id){setError(error instanceof Error?error.message:'AI 解析失敗，請稍後再試。');setDetails(error instanceof AiClientError?error.details:[]);}}
    finally{if(generation.current===id){request.current=null;setPending(false);}}
  };
  const plan=result?.status==='ready'?validateMission(result.mission).plan:null;

  return <section className="ai-composer" aria-label="AI 中文編程">
    <p className="ai-intro">用中文描述飛行順序，轉成積木確認後，再開始模擬。</p>
    <label className="mission-label">AI 來源<select aria-label="AI 來源" value={provider} disabled={disabled} onChange={event=>{
      cancel();setResult(null);setError('');setDetails([]);const value=event.target.value as AiProvider;setProvider(value);try{window.sessionStorage.setItem('drone-ai-provider',value);}catch{}
    }}><option value="api_key">OpenAI API Key（後端設定）</option><option value="chatgpt">ChatGPT 方案（本機登入）</option></select></label>
    {provider==='api_key'&&<ApiModelPicker disabled={disabled||pending} value={apiModel} onChange={apiModelChange}/>}
    {provider==='chatgpt'&&<ChatGptConnection disabled={disabled||pending} onChange={connectionChange}/>}
    {publicContext&&<details><summary>本關傳送給 AI 的公開區域資訊</summary><p>{publicContext}</p><button disabled={disabled} onClick={()=>editPrompt('起飛後依序前往停車場、露營區及貨櫃區，使用建議高度和朝下相機各拍一張照片，最後返航。')}>攝影尋寶中文範例</button></details>}
    <label className="mission-label" htmlFor="ai-prompt">中文飛行任務 <small>{prompt.length} / {promptLimit}</small></label>
    <textarea id="ai-prompt" rows={4} maxLength={Math.max(0,promptLimit)} value={prompt} disabled={disabled} onChange={event=>editPrompt(event.target.value)} placeholder={PROMPT_EXAMPLES[0]} aria-describedby="ai-input-hint"/>
    <div className="ai-examples" aria-label="中文範例"><span>試試看</span>{PROMPT_EXAMPLES.map((text,i)=><button key={text} disabled={disabled} onClick={()=>editPrompt(text)} title={text}>{['轉向與前進','側向平移','座標與返航','同時飛圓'][i]}</button>)}</div>
    <p className="mission-hint" id="ai-input-hint">請寫清楚起飛高度、方向、距離、角度及最後如何降落。按產生後，描述會傳送至 OpenAI；請勿輸入個人資料。</p>
    {prompt.length>promptLimit&&<p role="alert">包含公開資訊後超過輸入上限，請縮短學生任務。</p>}
    <div className="ai-actions"><button className="primary" disabled={disabled||pending||!prompt.trim()||prompt.length>promptLimit||(provider==='chatgpt'&&!chatGptReady)} onClick={generate}>{pending?'解析中…':'產生任務'}</button>{pending&&<button onClick={()=>{cancel();setError('已取消 AI 解析，輸入已保留。');}}>取消解析</button>}</div>
    {pending&&<p role="status" className="mission-hint">正在解析任務並檢查飛行限制，最長 {provider==='chatgpt'?'60':'30'} 秒。</p>}
    {error&&<div role="alert" className="ai-error"><b>{error}</b>{details.length>0&&<ul>{details.map((detail,i)=><li key={i}>{detail}</li>)}</ul>}</div>}
    {result&&<div className={'ai-answer '+result.status} role="status"><b>{result.status==='ready'?'任務已通過驗證，尚未執行':result.status==='clarification'?'請補充任務內容':'此任務目前無法產生'}</b><p>{result.message}</p>{result.questions.length>0&&<ul>{result.questions.map((question,i)=><li key={i}>{question}</li>)}</ul>}</div>}
    {plan&&<div className="ai-preview">
      <p>任務已轉成下方積木，請確認與修改後再執行。</p>
      <div className="ai-actions"><button disabled={disabled||pending} onClick={()=>onUse(JSON.stringify(plan.mission),false)}>轉成積木編輯</button></div>
      <p className="mission-hint">可在上方暫停、繼續、停止或重置任務，完成後可重新執行。</p>
    </div>}
    <div className="ai-fallback"><span>也可以不使用 AI</span><button disabled={disabled||pending} onClick={()=>{onUse(JSON.stringify(PRESETS[0].mission,null,2),false);onEdit();}}>使用起降預設</button><button disabled={disabled||pending} onClick={onEdit}>編輯任務積木</button></div>
  </section>;
}
