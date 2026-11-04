import { it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync,mkdirSync,mkdtempSync,writeFileSync,unlinkSync,rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { request } from 'node:https';
import { createServer as httpServer } from 'node:http';
import { once } from 'node:events';
import { createServer } from 'vite';
import { loadLocalTls,privateServerPath } from '../scripts/https';
import { readConfig } from '../server/config';

it('TLS is optional without files, required mode fails closed, and incomplete/invalid exports are rejected',()=>{
  const root=mkdtempSync(join(tmpdir(),'ai-drone-https-'));
  try{
    assert.equal(loadLocalTls(root),undefined);assert.throws(()=>loadLocalTls(root,'1'),/完整匯出/);assert.equal(loadLocalTls(root,'0'),undefined);
    // Check a lone file without reading or printing any real private key.
    mkdirSync(join(root,'ssl'));writeFileSync(join(root,'ssl/server-fullchain.pem'),'invalid');assert.throws(()=>loadLocalTls(root),/完整匯出/);writeFileSync(join(root,'ssl/server-privatekey.pem'),'invalid');assert.throws(()=>loadLocalTls(root),/格式錯誤/);
  }finally{for(const name of ['server-fullchain.pem','server-privatekey.pem']){const p=join(root,'ssl',name);if(existsSync(p))unlinkSync(p);}if(existsSync(join(root,'ssl')))rmdirSync(join(root,'ssl'));rmdirSync(root);}
});
it('private certificate paths, encoded paths and backend source are denied',()=>{
  for(const url of ['/ssl/server-privatekey.pem','/ssl%2fserver-privatekey.pem?raw','/@fs/C:/app/SSL/server-privatekey.pem?raw','/server/.env','/cert.key?import','/%ZZ'])assert.equal(privateServerPath(url),true,url);
  for(const url of ['/','/manifest.webmanifest','/api/ai/mission','/src/main.tsx'])assert.equal(privateServerPath(url),false,url);
});
it('HTTPS domain origins are exact and validated, retaining local HTTP compatibility',()=>{
  const config=readConfig({AI_DEV_FRONTEND_PORT:'5443',AI_DEV_FRONTEND_ORIGINS:'https://drone.example.test:5443'});assert.ok(config.origins.includes('https://drone.example.test:5443'));assert.ok(config.origins.includes('https://localhost:5443'));assert.ok(config.origins.includes('http://127.0.0.1:5443'));assert.throws(()=>readConfig({AI_DEV_FRONTEND_ORIGINS:'https://drone.example.test/path'}));
});
it('real supplied certificate serves trusted HTTPS, PWA assets and same-origin API proxy without exposing SSL files',async(t)=>{
  const root=fileURLToPath(new URL('../',import.meta.url));if(!existsSync(join(root,'ssl/server-fullchain.pem'))||!existsSync(join(root,'ssl/server-privatekey.pem'))){t.skip('Real deployment certificate is intentionally excluded from the repository');return;}
  const tls=loadLocalTls(root,'1')!;assert.ok(tls.hosts.length>0);
  const backend=httpServer((_req,res)=>{res.setHeader('Content-Type','application/json');res.end('{"test":true}');});backend.listen(0,'127.0.0.1');await once(backend,'listening');const backendPort=(backend.address() as {port:number}).port;
  const previous=process.env.AI_DEV_TARGET;process.env.AI_DEV_TARGET=`http://127.0.0.1:${backendPort}`;
  let server:Awaited<ReturnType<typeof createServer>>|undefined;
  try{
    server=await createServer({root,configFile:join(root,'vite.config.ts'),server:{host:'127.0.0.1',port:0,https:tls.options},logLevel:'silent'});await server.listen();const port=(server.httpServer!.address() as {port:number}).port;
    const get=(path:string)=>new Promise<{status:number;body:string}>((resolve,reject)=>{const req=request({hostname:'127.0.0.1',servername:tls.hosts[0],port,agent:false,path:path.replaceAll(' ','%20'),headers:{Host:`${tls.hosts[0]}:${port}`}},res=>{let body='';res.setEncoding('utf8');res.on('data',c=>body+=c);res.on('end',()=>resolve({status:res.statusCode!,body}));});req.on('error',reject);req.setTimeout(5000,()=>req.destroy(new Error('Local HTTPS test timed out')));req.end();});
    assert.match((await get('/')).body,/rel="manifest"/);assert.equal((await get('/manifest.webmanifest')).status,200);assert.equal((await get('/icons/drone-512.png')).status,200);assert.equal((await get('/api/ai/health')).body,'{"test":true}');
    for(const path of ['/ssl/server-privatekey.pem','/ssl/server-fullchain.pem','/ssl%2fserver-privatekey.pem?raw','/@fs/'+root.replaceAll('\\','/')+'/ssl/server-privatekey.pem?raw','/server/.env']){const response=await get(path);assert.equal(response.status,403,path);assert.ok(!response.body.includes('PRIVATE KEY'));}
  }finally{await server?.close();backend.closeAllConnections();await new Promise<void>(resolve=>backend.close(()=>resolve()));if(previous===undefined)delete process.env.AI_DEV_TARGET;else process.env.AI_DEV_TARGET=previous;}
});
