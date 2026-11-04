import { useEffect, useState } from 'react';
import type { ChatGptStatus } from '../ai/contracts';
import { readAiResponse } from '../ai/http';
interface Model {slug:string;displayName:string}
async function call<T>(path:string,body?:unknown,signal?:AbortSignal):Promise<T>{
  const controller=new AbortController(),cancel=()=>controller.abort();
  if(signal?.aborted)controller.abort();else signal?.addEventListener('abort',cancel,{once:true});
  const timer=setTimeout(cancel,30000);
  try{
    const res=await fetch('/api/ai/chatgpt/'+path,{...(body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}),signal:controller.signal});
    return await readAiResponse<T>(res);
  }catch(error){
    if(controller.signal.aborted)throw new Error(signal?.aborted?'已取消 ChatGPT 連線操作。':'ChatGPT 連線逾時，請確認本機後端已啟動後重試。');
    if(error instanceof TypeError)throw new Error('無法連線至 AI 後端，請執行 pnpm dev 後重新整理連線。');
    throw error;
  }finally{clearTimeout(timer);signal?.removeEventListener('abort',cancel);}
}
export function ChatGptConnection({disabled,onChange}:{disabled:boolean;onChange:(model:string,ready:boolean)=>void}){
  const [status,setStatus]=useState<ChatGptStatus|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const [url,setUrl]=useState(''),[models,setModels]=useState<Model[]>([]),[model,setModel]=useState(''),[revision,setRevision]=useState(0);
  const [choice,setChoice]=useState<string|undefined>();
  const active=status?.accounts.find(p=>p.id===status.activeId),pending=status?.login.state==='pending'||status?.login.state==='processing';
  useEffect(()=>{
    const abort=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;
    const refresh=async()=>{try{
      const next=await call<ChatGptStatus>('status',undefined,abort.signal);if(abort.signal.aborted)return;
      if(!Array.isArray(next.accounts)||!next.login||typeof next.login.message!=='string'||!['idle','pending','processing','completed','failed'].includes(next.login.state))throw new Error('ChatGPT 連線狀態格式不正確，請重啟本機後端。');
      setStatus(next);setError('');if(next.login.state==='completed')setChoice(next.activeId??undefined);
      if(next.login.state==='pending'||next.login.state==='processing')timer=setTimeout(refresh,1500);else setUrl('');
    }catch(error){if(!abort.signal.aborted){setError(error instanceof Error?error.message:'無法取得 ChatGPT 連線狀態。');onChange('',false);}}};
    void refresh();return()=>{abort.abort();if(timer)clearTimeout(timer);};
  },[revision,onChange]);
  useEffect(()=>{
    const abort=new AbortController();setModels([]);setModel('');onChange('',false);
    if(active?.sharing&&!pending){void call<{models:Model[]}>('models',undefined,abort.signal).then(result=>{
      if(abort.signal.aborted)return;if(!Array.isArray(result.models)||!result.models.length)throw new Error('此帳號沒有可用模型，請確認 ChatGPT 方案與授權。');
      setModels(result.models);setModel(result.models[0].slug);onChange(result.models[0].slug,true);
    }).catch(error=>{if(!abort.signal.aborted)setError(error instanceof Error?error.message:'無法讀取 ChatGPT 模型。');});}
    return()=>abort.abort();
  },[active?.id,active?.sharing,pending,revision,onChange]);
  const action=async(path:string,body:unknown={})=>{
    setBusy(true);setError('');onChange('',false);
    try{
      const result=await call<{url?:string;revoked?:boolean}>(path,body);
      if(result.url){const parsed=new URL(result.url);if(parsed.origin!=='https://auth.openai.com'||parsed.pathname!=='/api/accounts/authorize')throw new Error('登入網址不正確。');setUrl(result.url);}
      setRevision(value=>value+1);
    }catch(error){setError(error instanceof Error?error.message:'ChatGPT 操作失敗，請確認本機後端已啟動。');}
    finally{setBusy(false);}
  };
  return <div className="chatgpt-connection" aria-label="ChatGPT 方案連線">
    <p>使用自己的 ChatGPT 方案額度。僅供本機單人操作，不會自動改用付費 API Key。</p>
    {status&&<><label>ChatGPT 帳號<select aria-label="ChatGPT 帳號" value={choice??status.activeId??''} disabled={disabled||busy||pending} onChange={event=>{setChoice(event.target.value);setUrl('');if(event.target.value)void action('select',{accountId:event.target.value});else{setModels([]);onChange('',false);}}}><option value="">新增 ChatGPT 帳號</option>{status.accounts.map(account=><option key={account.id} value={account.id}>{account.label} · {account.id.slice(0,6)}{account.connected?'':'（已登出）'}</option>)}</select></label>
    <p role="status">{status.login.message}{active?.sharing&&!pending?' · 使用 ChatGPT 方案':''}</p></>}
    <div className="ai-actions"><button disabled={disabled||busy||pending||!status} onClick={()=>void action('login',(choice??status?.activeId)?{accountId:choice??status?.activeId}:{})}>Continue with ChatGPT</button>
    {pending&&<button disabled={disabled||busy||status?.login.state==='processing'} onClick={()=>void action('cancel')}>取消登入</button>}
    {active?.connected&&<button disabled={disabled||busy||pending} onClick={()=>void action('logout')}>登出 ChatGPT</button>}
    <button disabled={disabled||busy} onClick={()=>{setError('');setRevision(value=>value+1);}}>重新整理連線</button></div>
    {url&&pending&&<a className="chatgpt-signin" href={url} target="_blank" rel="noopener noreferrer">前往 OpenAI 登入並授權 ↗</a>}
    {models.length>0&&<label>ChatGPT 模型<select aria-label="ChatGPT 模型" value={model} disabled={disabled||busy||pending} onChange={event=>{setModel(event.target.value);onChange(event.target.value,true);}}>{models.map(item=><option key={item.slug} value={item.slug}>{item.displayName}</option>)}</select></label>}
    {error&&<p role="alert" className="ai-error">{error}</p>}
    <a href="https://chatgpt.com/" target="_blank" rel="noopener noreferrer">前往 ChatGPT（設定 → 用量，可調整應用額度）↗</a>
  </div>;
}
