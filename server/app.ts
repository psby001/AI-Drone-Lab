import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile, realpath } from 'node:fs/promises';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AI_LIMITS as A, type AiResult } from '../src/ai/contracts';
import { AiError, createMissionService, validatePrompt } from './service';
import type { ServerConfig } from './config';
import { createApiModelCatalog } from './models';
import { RequestLimiter } from './rate-limit';
import type { ChatGptAuth } from './chatgpt/auth';
import { createChatGptInference } from './chatgpt/inference';
const DIST=resolve(dirname(fileURLToPath(import.meta.url)),'../dist');
function json(res:ServerResponse,status:number,body:unknown){
  if(res.destroyed||res.writableEnded)return;
  res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(body));
}
async function readBody(req:IncomingMessage):Promise<unknown>{
  if(req.headers['content-type']?.split(';')[0].trim()!=='application/json')throw new AiError(415,'CONTENT_TYPE','請使用 JSON 格式傳送任務。');
  const declared=Number(req.headers['content-length']);
  if(Number.isFinite(declared)&&declared>A.maxBodyBytes){req.resume();throw new AiError(413,'BODY_TOO_LARGE','輸入資料過大，請縮短任務描述。');}
  const chunks:Buffer[]=[];let bytes=0;
  // Do not destroy the request stream on overflow: return a readable 413 response.
  return new Promise((accept,reject)=>{
    let exceeded=false;
    req.on('data',(chunk:Buffer)=>{
      bytes+=chunk.length;if(bytes>A.maxBodyBytes){if(!exceeded){exceeded=true;reject(new AiError(413,'BODY_TOO_LARGE','輸入資料過大，請縮短任務描述。'));}return;}chunks.push(chunk);
    });
    req.on('end',()=>{if(exceeded)return;try{accept(JSON.parse(Buffer.concat(chunks).toString('utf8')));}catch{reject(new AiError(400,'INVALID_JSON','請傳送合法 JSON。'));}});
    req.on('error',()=>reject(new AiError(400,'INVALID_INPUT','請求中斷，請重試。')));
    req.on('aborted',()=>reject(new AiError(400,'INVALID_INPUT','請求中斷，請重試。')));
  });
}
async function serveStatic(req:IncomingMessage,res:ServerResponse,path:string){
  const types:Record<string,string>={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.py':'text/x-python; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.ico':'image/x-icon','.woff2':'font/woff2'};
  let file:string;
  try{const decoded=decodeURIComponent(path);if(decoded.includes('\0')||decoded.split(/[\\/]/).some(part=>part.startsWith('.')))throw new Error();file=resolve(DIST,'.'+decoded);}catch{json(res,404,{error:{code:'NOT_FOUND',message:'找不到此資源。'}});return;}
  if(file!==DIST&&!file.startsWith(DIST+sep)){json(res,404,{error:{code:'NOT_FOUND',message:'找不到此資源。'}});return;}
  if(path==='/'||(!extname(file)&&req.headers.accept?.includes('text/html')))file=resolve(DIST,'index.html');
  try{
    const actual=await realpath(file);
    if(!actual.startsWith(DIST+sep)||!types[extname(actual)])throw new Error();
    const data=await readFile(actual);res.writeHead(200,{'Content-Type':types[extname(actual)],'X-Content-Type-Options':'nosniff','Cache-Control':'no-cache'});res.end(req.method==='HEAD'?undefined:data);
  }catch{json(res,404,{error:{code:'NOT_FOUND',message:'找不到此資源；正式模式請先執行 pnpm build。'}});}
}
export function createAiServer(config:ServerConfig,options:{parse?:(prompt:string,signal?:AbortSignal,model?:string)=>Promise<AiResult>;apiFetch?:typeof fetch;clock?:()=>number;chatgpt?:ChatGptAuth;chatgptFetch?:typeof fetch}={}){
  const parse=options.parse??createMissionService(config,options.apiFetch),catalog=createApiModelCatalog(config,options.apiFetch),limiter=new RequestLimiter(config,options.clock);let concurrent=0;
  const chatgpt=options.chatgpt,inference=chatgpt?createChatGptInference(config,chatgpt,options.chatgptFetch):null;
  const loopback=(address:string)=>['127.0.0.1','::1','::ffff:127.0.0.1','localhost'].includes(address);
  const local=(req:IncomingMessage)=>{
    const forwarded=req.headers['x-ai-client-address'];
    let host='';try{host=new URL('http://'+req.headers.host).hostname;}catch{}
    return req.headers['sec-fetch-site']!=='cross-site'&&(loopback(config.host)||config.host==='0.0.0.0'||config.host==='::')&&loopback(req.socket.remoteAddress??'')&&(!forwarded||(typeof forwarded==='string'&&loopback(forwarded)))&&['localhost','127.0.0.1','[::1]'].includes(host)&&(!req.headers.origin||['localhost','127.0.0.1','[::1]'].includes(new URL(req.headers.origin).hostname));
  };
  const server=createServer(async(req,res)=>{
    let path:string;try{path=new URL(req.url??'/','http://localhost').pathname;}catch{json(res,400,{error:{code:'INVALID_URL',message:'網址格式錯誤。'}});return;}
    if(!path.startsWith('/api/')){if(req.method==='GET'||req.method==='HEAD')await serveStatic(req,res,path);else json(res,405,{error:{code:'METHOD',message:'不支援此操作。'}});return;}
    const origin=req.headers.origin;
    if(origin&&!config.origins.includes(origin)){json(res,403,{error:{code:'ORIGIN_DENIED',message:'此網站尚未獲允許使用 AI 服務，請通知老師設定。'}});return;}
    if(origin){res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Vary','Origin');}
    if(req.method==='OPTIONS'){
      res.writeHead(204,{'Access-Control-Allow-Methods':'GET, POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type','Cache-Control':'no-store'});res.end();return;
    }
    if(path==='/api/ai/health'&&req.method==='GET'){json(res,200,{configured:Boolean(config.apiKey),maxInputLength:A.maxInputLength});return;}
    if(path==='/api/ai/models'&&req.method==='GET'){
      try{json(res,200,{models:await catalog.list(),defaultModel:config.model});}
      catch(error){const known=error instanceof AiError?error:new AiError(502,'MODEL_CATALOG','無法取得 API 模型清單，請稍後重試。');json(res,known.status,{error:{code:known.code,message:known.message}});}return;
    }
    if(path.startsWith('/api/ai/chatgpt/')){
      try{
        if(!local(req)||!chatgpt||!inference)throw new AiError(403,'LOCAL_ONLY','ChatGPT 方案模式僅供本機單人使用，請從同一台電腦的 localhost 開啟。');
        if(path==='/api/ai/chatgpt/status'&&req.method==='GET'){json(res,200,await chatgpt.status());return;}
        if(path==='/api/ai/chatgpt/models'&&req.method==='GET'){json(res,200,{models:await inference.models()});return;}
        if(req.method!=='POST')throw new AiError(405,'METHOD','請使用 POST。');
        if(!req.headers.origin)throw new AiError(403,'ORIGIN_REQUIRED','請從本機模擬器操作 ChatGPT 連線。');
        if(concurrent)throw new AiError(409,'AI_BUSY','請先完成或取消目前的 AI 請求，再變更帳號連線。');
        const body=await readBody(req) as Record<string,unknown>;
        if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(key=>key!=='accountId')||('accountId'in body&&(typeof body.accountId!=='string'||body.accountId.length>100)))throw new AiError(400,'INVALID_INPUT','帳號操作格式不正確。');
        if(path==='/api/ai/chatgpt/login'){json(res,200,await chatgpt.start(body.accountId as string|undefined));return;}
        if(path==='/api/ai/chatgpt/cancel'){await chatgpt.cancel();json(res,200,{ok:true});return;}
        if(path==='/api/ai/chatgpt/select'&&typeof body.accountId==='string'){await chatgpt.select(body.accountId);json(res,200,{ok:true});return;}
        if(path==='/api/ai/chatgpt/logout'){json(res,200,await chatgpt.logout());return;}
        throw new AiError(404,'NOT_FOUND','找不到此帳號操作。');
      }catch(error){const known=error instanceof AiError?error:new AiError(503,'CHATGPT_CONNECTION','ChatGPT 連線操作失敗，請稍後再試。');json(res,known.status,{error:{code:known.code,message:known.message}});}return;
    }
    if(path!=='/api/ai/mission'){json(res,404,{error:{code:'NOT_FOUND',message:'找不到此服務。'}});return;}
    if(req.method!=='POST'){res.setHeader('Allow','POST');json(res,405,{error:{code:'METHOD',message:'請使用 POST 產生任務。'}});return;}
    const abort=new AbortController();const disconnect=()=>{if(!res.writableEnded)abort.abort();};res.on('close',disconnect);
    let acquired=false;
    try{
      const body=await readBody(req);
      if(!body||typeof body!=='object'||Array.isArray(body)||!('prompt'in body)||Object.keys(body).some(key=>!['prompt','provider','model'].includes(key)))throw new AiError(400,'INVALID_INPUT','任務描述格式不正確。');
      const request=body as {prompt:unknown;provider?:unknown;model?:unknown};
      if(request.provider!==undefined&&!['api_key','chatgpt'].includes(request.provider as string))throw new AiError(400,'INVALID_INPUT','請選擇支援的 AI 來源。');
      const useChatGpt=request.provider==='chatgpt';
      if(useChatGpt&&(!local(req)||!chatgpt||!inference))throw new AiError(403,'LOCAL_ONLY','ChatGPT 模式僅供本機單人使用。');
      if(useChatGpt&&(typeof request.model!=='string'||!request.model||request.model.length>150))throw new AiError(400,'CHATGPT_MODEL','請先選擇 ChatGPT 可用模型。');
      if(!useChatGpt&&request.model!==undefined){if(typeof request.model!=='string'||!request.model||request.model.length>150)throw new AiError(400,'API_MODEL','請選擇有效的 API 模型。');}
      const prompt=validatePrompt((body as {prompt:unknown}).prompt);
      if(concurrent>=config.maxConcurrent)throw new AiError(503,'BUSY','目前正在解析的任務較多，請稍後再試。');
      // Use the socket peer, never a client-controlled X-Forwarded-For header.
      const retryAfter=limiter.take(req.socket.remoteAddress??'unknown');
      if(retryAfter){res.setHeader('Retry-After',String(retryAfter));json(res,429,{error:{code:'RATE_LIMIT',message:'已達 AI 請求次數限制，請稍候或使用預設任務。'},retryAfter});return;}
      concurrent++;acquired=true;json(res,200,useChatGpt?await inference!.parse(prompt,request.model as string,abort.signal):await (async()=>{if(request.model!==undefined&&!((await catalog.list()).includes(request.model as string)))throw new AiError(400,'API_MODEL','所選模型不在目前 API Key 可用清單內，請更新模型清單。');return parse(prompt,abort.signal,request.model as string|undefined);})());
    }catch(error){
      const known=error instanceof AiError?error:new AiError(500,'INTERNAL_ERROR','AI 服務暫時無法使用，請使用預設任務。');
      if(known.code==='BUSY'||known.code==='PROVIDER_RATE_LIMIT')res.setHeader('Retry-After','30');
      json(res,known.status,{error:{code:known.code,message:known.message,...(known.details?{details:known.details}:{})}});
    }finally{if(acquired)concurrent--;res.off('close',disconnect);}
  });
  server.requestTimeout=10000;server.headersTimeout=10000;server.maxHeadersCount=40;
  server.on('close',()=>chatgpt?.dispose());
  return server;
}
