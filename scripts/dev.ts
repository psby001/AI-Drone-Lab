import { spawn, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { loadLocalTls } from './https';
const cwd=fileURLToPath(new URL('../',import.meta.url));
const rawArgs=process.argv.slice(2),args=rawArgs.filter(arg=>arg!=='--https'&&arg!=='--http');let frontendPort=5173;
if(rawArgs.includes('--https')&&rawArgs.includes('--http'))throw new Error('請選擇 --https 或 --http。');
const tlsMode=rawArgs.includes('--https')?'1':rawArgs.includes('--http')?'0':process.env.DRONE_HTTPS;
const tls=loadLocalTls(cwd,tlsMode);
for(let i=0;i<args.length;i++){if(args[i]==='--port')frontendPort=Number(args[++i]);else if(args[i].startsWith('--port='))frontendPort=Number(args[i].slice(7));}
if(!Number.isInteger(frontendPort)||frontendPort<1||frontendPort>65535)throw new Error('前端 port 必須介於 1–65535。');
let frontend:ChildProcess|undefined,stopping=false;
const frontendOrigins=tls?tls.hosts.map(host=>`https://${host}${frontendPort===443?'':`:${frontendPort}`}`).join(','):'';
console.info(tls?`HTTPS 已啟用：${frontendOrigins||'請使用憑證對應的網域'}（不會重新申請憑證）`:'HTTP 預覽；ssl 內放入完整 PEM 憑證與私鑰可啟用 HTTPS。');
const backend=spawn(process.execPath,['--import','tsx','server/index.ts'],{cwd,stdio:['inherit','inherit','inherit','ipc'],windowsHide:true,env:{...process.env,AI_DEV_FRONTEND_PORT:String(frontendPort),AI_DEV_FRONTEND_ORIGINS:frontendOrigins,AI_DEV_FRONTEND_PROTOCOL:tls?'https':'http'}});
const stop=(code:number)=>{
  if(stopping)return;stopping=true;process.exitCode=code;clearTimeout(timer);
  frontend?.kill('SIGTERM');backend.kill('SIGTERM');
};
const timer=setTimeout(()=>{console.error('AI 後端未能啟動，請檢查連接埠與 server/.env 設定。');stop(1);},15000);
backend.once('error',()=>{console.error('無法啟動 AI 後端。');stop(1);});
backend.once('exit',code=>{if(!stopping){console.error('AI 後端已停止；若連接埠已被使用，請先關閉舊程序。');stop(code||1);}});
backend.once('message',(message:unknown)=>{
  const ready=message as {type?:string;port?:number;host?:string};
  if(ready?.type!=='ai-ready'||!Number.isInteger(ready.port)||!ready.host){console.error('AI 後端啟動資訊不完整。');stop(1);return;}
  clearTimeout(timer);
  const host=['0.0.0.0','localhost'].includes(ready.host)?'127.0.0.1':ready.host==='::'?'[::1]':ready.host.includes(':')?`[${ready.host}]`:ready.host;
  const frontendEnv:NodeJS.ProcessEnv={...process.env,DRONE_HTTPS:tls?'1':'0',AI_DEV_TARGET:`http://${host}:${ready.port}`};delete frontendEnv.OPENAI_API_KEY;
  frontend=spawn(process.execPath,[resolve(cwd,'node_modules/vite/bin/vite.js'),'--host','0.0.0.0',...args,'--strictPort'],{
    cwd,windowsHide:true,stdio:'inherit',env:frontendEnv,
  });
  frontend.once('error',()=>{console.error('無法啟動網頁預覽。');stop(1);});
  frontend.once('exit',code=>stop(code??1));
});
process.once('SIGINT',()=>stop(0));process.once('SIGTERM',()=>stop(0));
