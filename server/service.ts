import Ajv from 'ajv';
import { AI_LIMITS as A, type AiResult } from '../src/ai/contracts';
import { validateMission } from '../src/missions/validate';
import type { ServerConfig } from './config';
import { aiOutputSchema, removeOptionalNulls } from './output-schema';
import { SYSTEM_PROMPT } from './prompt';
const checkOutput=new Ajv({strict:false,allErrors:false}).compile(aiOutputSchema);
export class AiError extends Error {
  constructor(readonly status:number,readonly code:string,message:string,readonly details?:string[]){super(message);}
}
export function validatePrompt(value:unknown):string {
  if(typeof value!=='string'||!value.trim())throw new AiError(400,'INVALID_INPUT','請輸入繁體中文飛行任務。');
  if(value.length>A.maxInputLength)throw new AiError(400,'INPUT_TOO_LONG',`最多輸入 ${A.maxInputLength} 字。`);
  return value.trim();
}
export function validateAiOutput(value:unknown):AiResult {
  if(!checkOutput(value))throw new AiError(502,'INVALID_OUTPUT','AI 回應格式不完整，請重新產生或使用預設任務。');
  const output=value as {status:AiResult['status'];message:string;questions:string[];mission:unknown};
  if(!output.message.trim()||output.message.length>A.maxMessageLength||output.questions.length>A.maxQuestions||output.questions.some(q=>!q.trim()||q.length>A.maxQuestionLength))throw new AiError(502,'INVALID_OUTPUT','AI 說明格式不正確，請重新產生。');
  if(output.status!=='ready'){
    if(output.mission!==null||(output.status==='clarification'&&!output.questions.length))throw new AiError(502,'INVALID_OUTPUT','AI 澄清格式不正確，請重新產生。');
    return {status:output.status,message:output.message,questions:output.questions,mission:null};
  }
  if(output.mission===null||output.questions.length)throw new AiError(502,'INVALID_OUTPUT','AI 任務尚未確認完整，請重新產生。');
  const result=validateMission(removeOptionalNulls(output.mission));
  if(!result.plan)throw new AiError(422,'INVALID_MISSION','AI 產生的任務未通過飛行安全驗證，請修改描述。',result.errors);
  return {status:'ready',message:output.message,questions:[],mission:result.plan.mission};
}
export async function boundedJson(response:Response,options:{maxBytes?:number;oversizeCode?:string;oversizeMessage?:string}={}):Promise<unknown>{
  if(!response.body)throw new AiError(502,'INVALID_OUTPUT','AI 服務沒有回傳內容。');
  const reader=response.body.getReader(),chunks:Uint8Array[]=[];let length=0;
  try{while(true){const {done,value}=await reader.read();if(done)break;length+=value.byteLength;if(length>(options.maxBytes??A.maxProviderBytes)){await reader.cancel();throw new AiError(502,options.oversizeCode??'INVALID_OUTPUT',options.oversizeMessage??'AI 回應過大，請縮短任務。');}chunks.push(value);}}
  finally{reader.releaseLock();}
  const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  try{return JSON.parse(new TextDecoder().decode(bytes));}catch{throw new AiError(502,'INVALID_OUTPUT','AI 回應無法讀取，請重新產生。');}
}
export function createMissionService(config:ServerConfig,fetcher:typeof fetch=fetch){
  return async(prompt:string,signal?:AbortSignal,model=config.model):Promise<AiResult>=>{
    prompt=validatePrompt(prompt);
    if(!config.apiKey)throw new AiError(503,'NOT_CONFIGURED','AI 服務尚未設定金鑰，請使用下方預設任務；手動飛行與 JSON 任務仍可使用。');
    const timeout=AbortSignal.timeout(config.timeoutMs),combined=signal?AbortSignal.any([signal,timeout]):timeout;
    try{
      const response=await fetcher('https://api.openai.com/v1/responses',{
        method:'POST',signal:combined,headers:{'Content-Type':'application/json',Authorization:`Bearer ${config.apiKey}`},
        body:JSON.stringify({model,store:false,max_output_tokens:A.maxOutputTokens,
          input:[{role:'system',content:SYSTEM_PROMPT},{role:'user',content:prompt}],
          text:{format:{type:'json_schema',name:'drone_mission',strict:true,schema:aiOutputSchema}}}),
      });
      if(!response.ok){
        await response.body?.cancel();
        if(response.status===429)throw new AiError(429,'PROVIDER_RATE_LIMIT','AI 服務目前額度或請求量受限，請稍後重試或使用預設任務。');
        if(response.status===400||response.status===404)throw new AiError(422,'MODEL_UNSUPPORTED','所選模型無法執行此任務或不支援 Structured Outputs，請選擇其他模型。');
        if(response.status===401||response.status===403)throw new AiError(503,'PROVIDER_AUTH','AI 服務授權失敗，請通知老師檢查後端設定。');
        throw new AiError(502,'PROVIDER_ERROR','AI 服務暫時無法使用，請稍後重試或使用預設任務。');
      }
      const envelope=await boundedJson(response) as {status?:string;output?:{type:string;content?:{type:string;text?:string}[]}[]};
      if(!envelope||envelope.status!=='completed'||!Array.isArray(envelope.output))throw new AiError(502,'INCOMPLETE_OUTPUT','AI 回應未完成，請簡化任務後重新產生。');
      const content=envelope.output.filter(item=>item.type==='message').flatMap(item=>item.content??[]);
      if(content.some(item=>item.type==='refusal'))throw new AiError(422,'REFUSED','AI 無法解析這項要求，請改寫成模擬器支援的飛行任務。');
      const texts=content.filter(item=>item.type==='output_text');
      if(texts.length!==1||typeof texts[0].text!=='string')throw new AiError(502,'INVALID_OUTPUT','AI 回應缺少完整任務，請重新產生。');
      let value:unknown;try{value=JSON.parse(texts[0].text);}catch{throw new AiError(502,'INVALID_OUTPUT','AI 回應不是合法 JSON，請重新產生。');}
      return validateAiOutput(value);
    }catch(error){
      if(error instanceof AiError)throw error;
      if(timeout.aborted)throw new AiError(504,'TIMEOUT','AI 解析逾時，輸入已保留，請稍後再試。');
      if(signal?.aborted)throw new AiError(499,'CANCELLED','已取消 AI 解析。');
      throw new AiError(502,'NETWORK_ERROR','無法連線至 AI 服務，輸入已保留，請使用預設任務或稍後再試。');
    }
  };
}
