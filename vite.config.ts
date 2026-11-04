import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import { loadLocalTls,privateServerPath } from './scripts/https';
export default defineConfig(({command})=>({
  plugins:[{name:'protect-backend-files',configureServer(server){
    server.middlewares.use((request,response,next)=>{
      if(privateServerPath(request.url??'/')){response.statusCode=403;response.setHeader('Content-Type','text/plain; charset=utf-8');response.end('Private server files');return;}
      next();
    });
  }}],
  server: {
    host:'0.0.0.0',
    https:command==='serve'?loadLocalTls(fileURLToPath(new URL('./',import.meta.url)))?.options:undefined,
    fs:{deny:['.env','.env.*','*.{crt,pem,key,pfx,p12,cer,der}','**/.git/**','**/server/**','**/ssl/**']},
    proxy: { '/api/ai': { target: process.env.AI_DEV_TARGET??'http://127.0.0.1:3001',configure(proxy){proxy.on('proxyReq',(outgoing,request)=>outgoing.setHeader('X-AI-Client-Address',request.socket.remoteAddress??'unknown'));} } },
  },
}));
