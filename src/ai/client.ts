import { AI_LIMITS as A, type AiResult } from './contracts';
import { validateMission } from '../missions/validate';
import { AiClientError,readAiResponse } from './http';
export { AiClientError } from './http';
export async function generateMission(prompt:string,signal?:AbortSignal,source?:{provider:'chatgpt'|'api_key';model:string}):Promise<AiResult>{
  if(!prompt.trim()||prompt.length>A.maxInputLength)throw new AiClientError(`請輸入 1–${A.maxInputLength} 字的任務。`);
  const controller=new AbortController();let timedOut=false;
  const cancel=()=>controller.abort();
  if(signal?.aborted)controller.abort();else signal?.addEventListener('abort',cancel,{once:true});
  const timer=setTimeout(()=>{timedOut=true;controller.abort();},source?.provider==='chatgpt'?A.chatgptClientTimeoutMs:A.clientTimeoutMs);
  try{
    const response=await fetch('/api/ai/mission',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({prompt,...source}),signal:controller.signal});
    const body=await readAiResponse<unknown>(response);
    if(!body||typeof body!=='object')throw new AiClientError('AI 回應格式不正確。');
    const result=body as AiResult;
    if(!['ready','clarification','rejected'].includes(result.status)||typeof result.message!=='string'||result.message.length>A.maxMessageLength||!Array.isArray(result.questions)||result.questions.length>A.maxQuestions||result.questions.some(q=>typeof q!=='string'||q.length>A.maxQuestionLength))throw new AiClientError('AI 回應格式不正確。');
    if(result.status!=='ready'){
      if(result.mission!==null||(result.status==='clarification'&&!result.questions.length))throw new AiClientError('AI 澄清格式不正確。');return result;
    }
    if(result.questions.length)throw new AiClientError('AI 任務仍有待確認的問題。');
    // Never trust the API: repeat the same schema and safety validator in browser.
    const validated=validateMission(result.mission);
    if(!validated.plan)throw new AiClientError('AI 任務未通過瀏覽器安全驗證。',validated.errors);
    return {...result,mission:validated.plan.mission};
  }catch(error){
    if(error instanceof AiClientError)throw error;
    if(signal?.aborted)throw new AiClientError('已取消 AI 解析，輸入已保留。');
    if(timedOut)throw new AiClientError('AI 解析逾時，輸入已保留，請稍後再試。');
    throw new AiClientError('無法連線至 AI 後端，請確認服務已啟動；輸入已保留，仍可使用預設任務。');
  }finally{clearTimeout(timer);signal?.removeEventListener('abort',cancel);}
}
