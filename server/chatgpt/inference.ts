import { AI_LIMITS as A, type AiResult } from '../../src/ai/contracts';
import type { ServerConfig } from '../config';
import { AiError, boundedJson, validateAiOutput, validatePrompt } from '../service';
import { aiOutputSchema } from '../output-schema';
import { SYSTEM_PROMPT } from '../prompt';
import type { ChatGptAuth } from './auth';
export interface ChatGptModel {slug:string;displayName:string}
function upstreamError(code?:unknown,status?:number,param?:unknown):AiError {
  if(code==='subscription_sharing_usage_limit_exceeded')return new AiError(429,'CHATGPT_LIMIT','ChatGPT 方案用量已達上限，請至 ChatGPT 設定查看用量或稍後再試；不會自動改用 API Key。');
  if(code==='subscription_sharing_usage_unavailable')return new AiError(403,'CHATGPT_UNAVAILABLE','此帳號目前無法使用 ChatGPT 方案用量，請確認方案、授權與工作區設定。');
  const safe=(value:unknown)=>typeof value==='string'&&/^[a-zA-Z0-9_.\/-]{1,100}$/.test(value)?value:undefined;
  const details=[...(status?[`OpenAI HTTP：${status}`]:[]),...(safe(code)?[`OpenAI 錯誤碼：${safe(code)}`]:[]),...(safe(param)?[`欄位：${safe(param)}`]:[])];
  if(status===429)return new AiError(429,'CHATGPT_RATE_LIMIT','ChatGPT 請求頻率或用量受限，請稍後重試；不會自動改用 API Key。',details);
  if(status===400||code==='invalid_json_schema'||code==='unsupported_parameter')return new AiError(502,'CHATGPT_REQUEST_REJECTED','ChatGPT 拒絕了目前的請求格式，請依下方錯誤碼檢查相容性。',details);
  return new AiError(502,'CHATGPT_RESPONSE','ChatGPT 服務未成功完成請求，請查看下方錯誤碼後重試。',details);
}
/** Only the terminal completed envelope is accepted; deltas never become missions. */
export async function readCompletedStream(response:Response):Promise<unknown>{
  if(!response.body)throw upstreamError();
  const reader=response.body.getReader(),decoder=new TextDecoder();let buffer='',bytes=0,completed:unknown;
  const finalized=new Map<number,Record<string,unknown>>();
  const tooLarge=()=>new AiError(502,'CHATGPT_STREAM_TOO_LARGE','ChatGPT 串流資料超過讀取上限，請重新產生或選擇其他模型。');
  const event=(block:string)=>{
    if(Buffer.byteLength(block,'utf8')>A.maxStreamEventBytes)throw tooLarge();
    const data=block.split('\n').filter(line=>line.startsWith('data:')).map(line=>line.slice(5).trimStart()).join('\n');
    if(!data||data==='[DONE]')return;
    let item:any;try{item=JSON.parse(data);}catch{throw upstreamError();}
    if(['response.failed','error'].includes(item.type))throw upstreamError(item.response?.error?.code??item.error?.code??item.code,undefined,item.response?.error?.param??item.error?.param??item.param);
    if(item.type==='response.incomplete')throw new AiError(502,'INCOMPLETE_OUTPUT','ChatGPT 回應被截斷，請簡化描述後重試。');
    if(item.type==='response.output_item.done'){
      if(completed||!Number.isInteger(item.output_index)||item.output_index<0||item.output_index>100||!item.item||typeof item.item!=='object'||Array.isArray(item.item)||finalized.has(item.output_index))throw upstreamError();
      // A done event can also carry an incomplete item after interruption.
      // Only completed assistant messages can supply the final mission.
      if(item.item.type==='message'&&(item.item.status!=='completed'||item.item.role!=='assistant'))throw new AiError(502,'INCOMPLETE_OUTPUT','ChatGPT 輸出項目未完整完成，沒有載入任務。');
      finalized.set(item.output_index,item.item);
    }
    if(item.type==='response.completed'){
      if(completed)throw upstreamError();
      if(item.response?.status!=='completed')throw upstreamError();completed=item.response;
    }
  };
  try{
    while(true){
      const {value,done}=await reader.read();if(done)break;bytes+=value.byteLength;
      if(bytes>A.maxStreamBytes)throw tooLarge();
      buffer+=decoder.decode(value,{stream:true});buffer=buffer.replace(/\r\n/g,'\n');
      let end:number;while((end=buffer.indexOf('\n\n'))>=0){event(buffer.slice(0,end));buffer=buffer.slice(end+2);}
      if(Buffer.byteLength(buffer,'utf8')>A.maxStreamEventBytes)throw tooLarge();
    }
    buffer+=decoder.decode();if(buffer.trim())event(buffer);
    if(!completed)throw new AiError(502,'INCOMPLETE_OUTPUT','ChatGPT 連線中斷或未收到完成確認，沒有載入任何任務。');
    const envelope=completed as {output?:unknown[]|null};
    // Some ChatGPT streams omit output from the terminal envelope. Rebuild
    // from authoritative item.done events, never from added items or deltas.
    if(envelope.output==null||(Array.isArray(envelope.output)&&envelope.output.length===0))return {...envelope,output:[...finalized.entries()].sort(([a],[b])=>a-b).map(([,item])=>item)};
    return completed;
  }finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
}
export function createChatGptInference(config:ServerConfig,auth:ChatGptAuth,fetcher:typeof fetch=fetch){
  const models=async(signal?:AbortSignal):Promise<ChatGptModel[]>=>{
    const {token}=await auth.access();
    const response=await fetcher('https://api.openai.com/v1/models',{headers:{Authorization:`Bearer ${token}`},signal:signal?AbortSignal.any([signal,AbortSignal.timeout(10000)]):AbortSignal.timeout(10000),redirect:'error'});
    if(!response.ok){await response.body?.cancel();throw new AiError(response.status===401?401:503,'CHATGPT_MODELS','無法取得 ChatGPT 可用模型，請重新登入或檢查用量權限。');}
    const value=await boundedJson(response,{
      maxBytes:A.maxModelCatalogBytes,oversizeCode:'CHATGPT_MODELS_TOO_LARGE',
      oversizeMessage:'ChatGPT 模型清單超過讀取上限，請重新整理連線或稍後再試。這不是飛行任務長度問題。',
    }) as {models?:{slug:string;display_name?:string;visibility:string}[]};
    if(!Array.isArray(value.models))throw new AiError(502,'CHATGPT_MODELS','ChatGPT 模型清單格式不正確。');
    return value.models.filter(m=>m&&m.visibility==='list'&&typeof m.slug==='string'&&m.slug.length>0&&m.slug.length<=150).slice(0,100).map(m=>({slug:m.slug,displayName:typeof m.display_name==='string'?m.display_name.slice(0,120):m.slug}));
  };
  const parse=async(prompt:string,model:string,signal?:AbortSignal):Promise<AiResult>=>{
    prompt=validatePrompt(prompt);const timeout=AbortSignal.timeout(config.chatgptTimeoutMs??A.chatgptTimeoutMs),combined=signal?AbortSignal.any([signal,timeout]):timeout;
    try{
      // Validate against the current account, never reuse the API-key model setting.
      const available=await models(combined);if(!available.some(m=>m.slug===model))throw new AiError(400,'CHATGPT_MODEL','請選擇目前 ChatGPT 帳號可用的模型。');
      const {token}=await auth.access();
      const response=await fetcher('https://api.openai.com/v1/responses',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},signal:combined,redirect:'error',
        body:JSON.stringify({model,store:false,stream:true,instructions:SYSTEM_PROMPT,input:[{role:'user',content:prompt}],text:{format:{type:'json_schema',name:'drone_mission',strict:true,schema:aiOutputSchema}}})});
      if(!response.ok){
        let error:{code?:unknown;type?:unknown;param?:unknown}|undefined;
        try{const body=await boundedJson(response,{maxBytes:65536}) as {error?:typeof error};error=body?.error;}catch{}
        if(response.status===401)throw new AiError(401,'CHATGPT_SIGN_IN','ChatGPT 授權已失效，請重新登入。');
        if(response.status===403&&!error?.code)throw upstreamError('subscription_sharing_usage_unavailable');
        throw upstreamError(error?.code??error?.type,response.status,error?.param);
      }
      const envelope=await readCompletedStream(response) as {output?:{type:string;content?:{type:string;text?:string}[]}[]};
      const content=(envelope.output??[]).filter(item=>item.type==='message').flatMap(item=>item.content??[]);
      if(content.some(item=>item.type==='refusal'))throw new AiError(422,'REFUSED','ChatGPT 無法解析這項要求，請改寫成支援的飛行任務。');
      const text=content.filter(item=>item.type==='output_text');
      if(text.length!==1||typeof text[0].text!=='string')throw new AiError(502,'CHATGPT_EMPTY_OUTPUT','ChatGPT 已結束回應，但沒有可驗證的完整任務文字，請重新產生。');
      if(Buffer.byteLength(text[0].text,'utf8')>A.maxProviderBytes)throw new AiError(502,'INVALID_OUTPUT','ChatGPT 產生的任務 JSON 過大，請縮短任務後重試。');
      let value:unknown;try{value=JSON.parse(text[0].text);}catch{throw new AiError(502,'INVALID_OUTPUT','ChatGPT 回傳內容不是合法 JSON，請重新產生。');}
      return validateAiOutput(value);
    }catch(error){
      if(error instanceof AiError)throw error;
      if(timeout.aborted)throw new AiError(504,'TIMEOUT','ChatGPT 解析逾時，輸入已保留；沒有改用 API Key。');
      if(signal?.aborted)throw new AiError(499,'CANCELLED','已取消 ChatGPT 解析。');
      throw new AiError(502,'CHATGPT_NETWORK','無法連線至 ChatGPT，請稍後再試；沒有改用 API Key。');
    }
  };
  return{models,parse};
}
