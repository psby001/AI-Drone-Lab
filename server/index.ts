import { loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';
import { readConfig } from './config';
import { createAiServer } from './app';
import { ChatGptAuth } from './chatgpt/auth';
import { LocalCredentialStore } from './chatgpt/store';
try{loadEnvFile(fileURLToPath(new URL('./.env',import.meta.url)));}
catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw new Error('無法讀取 server/.env，請檢查格式與權限。');}
const config=readConfig();
const chatgpt=new ChatGptAuth(new LocalCredentialStore(fileURLToPath(new URL('./.local/chatgpt/',import.meta.url))));
const server=createAiServer(config,{chatgpt});
server.on('error',(error:NodeJS.ErrnoException)=>{console.error(error.code==='EADDRINUSE'?'AI 後端連接埠已被使用。':'AI 後端啟動失敗，請檢查主機與連接埠設定。');process.exitCode=1;});
server.listen(config.port,config.host,()=>{
  process.send?.({type:'ai-ready',port:config.port,host:config.host});
  console.info(`AI Drone Lab 後端：http://${config.host}:${config.port} · ${config.apiKey?'API Key 已設定':'API Key 未設定；可使用本機 ChatGPT 登入或預設任務'}`);
});
