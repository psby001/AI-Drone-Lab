import { AI_LIMITS as A } from '../src/ai/contracts';
import { networkInterfaces } from 'node:os';
export interface ServerConfig {
  apiKey: string; model: string; host: string; port: number; origins: string[];
  timeoutMs: number; chatgptTimeoutMs?: number; perIpMinute: number; perIpHour: number;
  globalMinute: number; globalHour: number; maxConcurrent: number;
}
export function readConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const integer=(key:string,fallback:number,min:number,max:number)=>{
    const value=env[key]===undefined?fallback:Number(env[key]);
    if(!Number.isInteger(value)||value<min||value>max)throw new Error(`${key} 設定值不合法`);
    return value;
  };
  const origins=(env.AI_ALLOWED_ORIGINS??'http://localhost:5173,http://127.0.0.1:5173,http://localhost:3001,http://127.0.0.1:3001').split(',').map(s=>s.trim()).filter(Boolean);
  if(env.AI_DEV_FRONTEND_PORT){const port=integer('AI_DEV_FRONTEND_PORT',5173,1,65535);for(const protocol of ['http','https'])origins.push(new URL(`${protocol}://localhost:${port}`).origin,new URL(`${protocol}://127.0.0.1:${port}`).origin);}
  if(env.AI_DEV_FRONTEND_ORIGINS)origins.push(...env.AI_DEV_FRONTEND_ORIGINS.split(',').map(s=>s.trim()).filter(Boolean));
  // Allow exact LAN addresses of this computer, never arbitrary remote origins.
  if((env.AI_HOST||'0.0.0.0')==='0.0.0.0'){
    const ports=[integer('AI_DEV_FRONTEND_PORT',5173,1,65535),integer('AI_PORT',3001,1,65535)];
    for(const entries of Object.values(networkInterfaces()))for(const entry of entries??[]){
      if(entry.family==='IPv4'&&!entry.internal&&/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(entry.address)){
        for(const port of ports)origins.push(`http://${entry.address}:${port}`);
      }
    }
  }
  if(!origins.length||origins.some(origin=>{try{const u=new URL(origin);return !['http:','https:'].includes(u.protocol)||u.origin!==origin;}catch{return true;}}))throw new Error('AI_ALLOWED_ORIGINS 必須是完整 origin，以逗號分隔');
  return {
    apiKey:env.OPENAI_API_KEY?.trim()??'',model:env.OPENAI_MODEL?.trim()||'gpt-4o-mini',
    host:env.AI_HOST||'0.0.0.0',port:integer('AI_PORT',3001,1,65535),origins:[...new Set(origins)],
    timeoutMs:integer('AI_TIMEOUT_MS',A.timeoutMs,100,25000),
    chatgptTimeoutMs:integer('CHATGPT_TIMEOUT_MS',A.chatgptTimeoutMs,100,60000),
    perIpMinute:integer('AI_PER_IP_MINUTE',A.perIpMinute,1,1000),
    perIpHour:integer('AI_PER_IP_HOUR',A.perIpHour,1,10000),
    globalMinute:integer('AI_GLOBAL_MINUTE',A.globalMinute,1,1000),
    globalHour:integer('AI_GLOBAL_HOUR',A.globalHour,1,10000),
    maxConcurrent:integer('AI_MAX_CONCURRENT',A.maxConcurrent,1,32),
  };
}
