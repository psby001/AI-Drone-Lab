import type { ServerConfig } from './config';
import { AiError, boundedJson } from './service';
import { AI_LIMITS } from '../src/ai/contracts';

/** Catalog membership is not a guarantee of Responses/Structured Outputs support. */
export function createApiModelCatalog(config:ServerConfig,fetcher:typeof fetch=fetch){
  let cached:string[]=[],expires=0,pending:Promise<string[]>|undefined;
  const load=async()=>{
    if(!config.apiKey)throw new AiError(503,'NOT_CONFIGURED','請先在後端設定 OpenAI API Key。');
    try{
      const response=await fetcher('https://api.openai.com/v1/models',{headers:{Authorization:`Bearer ${config.apiKey}`},signal:AbortSignal.timeout(10000),redirect:'error'});
      if(!response.ok){await response.body?.cancel();throw new AiError(response.status===429?429:503,'MODEL_CATALOG','無法取得模型清單，請檢查後端金鑰、權限或稍後重試。');}
      const body=await boundedJson(response,{maxBytes:AI_LIMITS.maxModelCatalogBytes}) as {data?:{id?:unknown}[]};
      if(!Array.isArray(body.data))throw new Error();
      cached=[...new Set(body.data.flatMap(item=>typeof item?.id==='string'&&item.id.length>0&&item.id.length<=150?[item.id]:[]))].sort();
      expires=Date.now()+60000;return [...cached];
    }catch(error){if(error instanceof AiError)throw error;throw new AiError(502,'MODEL_CATALOG','取得模型清單逾時或連線失敗，請重試。');}
  };
  return{async list(){if(Date.now()<expires)return [...cached];if(!pending)pending=load().finally(()=>{pending=undefined;});return [...await pending];}};
}
