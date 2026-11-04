export class AiClientError extends Error {
  constructor(message:string,readonly details:string[]=[]){super(message);}
}
/** Never expose a JSON parser exception or HTML error page to students. */
export async function readAiResponse<T>(response:Response):Promise<T>{
  const contentType=response.headers.get('content-type')??'';
  if(!/^application\/(?:[a-z0-9.+-]*\+)?json(?:\s*;|$)/i.test(contentType)){
    await response.body?.cancel().catch(()=>{});
    throw new AiClientError(response.status>=500
      ?'未連上 AI 後端服務。請在專案目錄執行 pnpm dev，同時啟動網頁與後端，再重新整理連線。'
      :'AI 連線網址回傳了網頁，未連上 JSON 服務。請關閉舊的開發伺服器，在專案目錄執行 pnpm dev 後重新開啟網頁。');
  }
  let result:unknown;
  try{result=await response.json();}catch{throw new AiClientError('AI 服務回傳的資料不完整，請重新整理連線或稍後再試。');}
  if(!result||typeof result!=='object'||Array.isArray(result))throw new AiClientError('AI 服務回應格式不正確，請重新整理連線。');
  if(!response.ok){
    const error=(result as {error?:{message?:unknown;details?:unknown}}).error;
    throw new AiClientError(typeof error?.message==='string'?error.message:'AI 服務暫時無法使用，請稍後再試。',Array.isArray(error?.details)?error.details.filter((item):item is string=>typeof item==='string'):[]);
  }
  return result as T;
}
