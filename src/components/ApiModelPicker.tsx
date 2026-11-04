import { useEffect,useRef,useState } from 'react';
import { readAiResponse } from '../ai/http';

export function ApiModelPicker({disabled,value,onChange}:{disabled:boolean;value:string;onChange:(model:string)=>void}){
  const [models,setModels]=useState<string[]>([]),[pending,setPending]=useState(false),[error,setError]=useState('');
  const request=useRef<AbortController|null>(null);
  useEffect(()=>()=>request.current?.abort(),[]);
  const load=async()=>{
    const controller=new AbortController();request.current=controller;setPending(true);setError('');
    const timer=setTimeout(()=>controller.abort(),15000);
    try{
      const response=await fetch('/api/ai/models',{signal:controller.signal});
      const body=await readAiResponse<{models:string[]}>(response);
      if(!Array.isArray(body.models)||body.models.some(model=>typeof model!=='string'))throw new Error('模型清單格式不正確。');
      if(!controller.signal.aborted){setModels(body.models);if(value&&!body.models.includes(value))onChange('');}
    }catch(error){if(request.current===controller&&!controller.signal.aborted)setError(error instanceof Error?error.message:'無法載入模型清單。');else if(request.current===controller)setError('模型清單載入逾時，請重試。');}
    finally{clearTimeout(timer);if(request.current===controller){request.current=null;setPending(false);}}
  };
  return <div>
    <label className="mission-label">API 模型<select aria-label="API 模型" value={value} disabled={disabled||pending} onChange={event=>onChange(event.target.value)}>
      <option value="">使用後端預設模型</option>{models.map(model=><option key={model} value={model}>{model}</option>)}
    </select></label>
    <button disabled={disabled||pending} onClick={load}>{pending?'載入模型中…':'更新 API 模型清單'}</button>
    <p className="mission-hint">依後端 API Key 取得可用清單；請選擇支援 Responses 與 Structured Outputs 的文字模型。清單不保證功能相容，不相容時請更換模型。</p>
    {error&&<p role="alert">{error}</p>}
  </div>;
}
