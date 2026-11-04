import { it } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createAiServer } from '../server/app';
import { readConfig } from '../server/config';
import { RequestLimiter } from '../server/rate-limit';
import { validateAiOutput } from '../server/service';
import { ready } from './fixtures/ai';
import type { ServerConfig } from '../server/config';
import type { AiResult } from '../src/ai/contracts';
async function fixture(config:ServerConfig,parse?:(prompt:string,signal?:AbortSignal)=>Promise<AiResult>){
  const server=createAiServer(config,{parse});server.listen(0,'127.0.0.1');await once(server,'listening');
  const url=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
  return {url,close:()=>new Promise<void>(resolve=>{server.close(()=>resolve());server.closeIdleConnections();})};
}
const config=()=>readConfig({OPENAI_API_KEY:'test-secret'});
const post=(url:string,body:unknown,headers:Record<string,string>={})=>fetch(url+'/api/ai/mission',{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body)});
it('HTTP endpoint accepts a task, rejects invalid requests/origins, and never exposes a key',async()=>{
  let calls=0;const f=await fixture(config(),async()=>{calls++;return validateAiOutput(ready());});
  try{
    const ok=await post(f.url,{prompt:'起飛5公尺最後降落'},{Origin:'http://localhost:5173'});assert.equal(ok.status,200);assert.equal((await ok.json()).status,'ready');
    assert.equal((await post(f.url,{prompt:'飛行'},{Origin:'https://untrusted.example'})).status,403);
    assert.equal((await post(f.url,{prompt:'飛行',apiKey:'injection'})).status,400);
    assert.equal((await post(f.url,{prompt:'飛'.repeat(1001)})).status,400);
    assert.equal((await post(f.url,{prompt:'飛'.repeat(9000)})).status,413);
    assert.equal((await fetch(f.url+'/api/ai/mission',{method:'POST',headers:{'Content-Type':'text/plain'},body:'{}'})).status,415);
    assert.equal((await fetch(f.url+'/api/ai/mission',{method:'POST',headers:{'Content-Type':'application/json'},body:'{'})).status,400);
    assert.equal((await fetch(f.url+'/api/ai/mission')).status,405);
    const health=await fetch(f.url+'/api/ai/health');assert.deepEqual(await health.json(),{configured:true,maxInputLength:1000});
    const secret=await fetch(f.url+'/server/.env');assert.equal(secret.status,404);assert.equal((await secret.text()).includes('test-secret'),false);
    assert.equal(calls,1);
  }finally{await f.close();}
});
it('HTTP requests are rate limited even when a client spoofs forwarded IPs',async()=>{
  const f=await fixture({...config(),perIpMinute:2},async()=>validateAiOutput(ready()));
  try{
    assert.equal((await post(f.url,{prompt:'任務'},{'X-Forwarded-For':'1.1.1.1'})).status,200);
    assert.equal((await post(f.url,{prompt:'任務'},{'X-Forwarded-For':'2.2.2.2'})).status,200);
    const response=await post(f.url,{prompt:'任務'},{'X-Forwarded-For':'3.3.3.3'});
    assert.equal(response.status,429);assert.ok(Number(response.headers.get('Retry-After'))>0);assert.equal((await response.json()).error.code,'RATE_LIMIT');
  }finally{await f.close();}
});
it('rate limiter enforces shared/global budgets and refreshes minute/hour windows',()=>{
  let now=0;const limit=new RequestLimiter({...config(),perIpMinute:1,perIpHour:2,globalMinute:2,globalHour:3},()=>now);
  assert.equal(limit.take('a'),0);assert.equal(limit.take('a'),60);assert.equal(limit.take('b'),0);assert.equal(limit.take('c'),60);
  now=60000;assert.equal(limit.take('a'),0);assert.ok(limit.take('a')>60);assert.ok(limit.take('c')>60);
  now=3600000;assert.equal(limit.take('a'),0);
});
it('supports eleven simultaneous students and rejects requests beyond the concurrency cap',async()=>{
  const release:((result:AiResult)=>void)[]=[];
  const f=await fixture(config(),async()=>new Promise<AiResult>(resolve=>release.push(resolve)));
  try{
    const pending=Array.from({length:12},()=>post(f.url,{prompt:'任務'}));
    const deadline=Date.now()+3000;
    while(release.length<12&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,5));
    assert.equal(release.length,12);
    const busy=await post(f.url,{prompt:'任務'});assert.equal(busy.status,503);assert.equal((await busy.json()).error.code,'BUSY');
    release.forEach(resolve=>resolve(validateAiOutput(ready())));
    const responses=await Promise.all(pending);assert.ok(responses.every(r=>r.status===200));
  }finally{release.forEach(resolve=>resolve(validateAiOutput(ready())));await f.close();}
});
it('unconfigured and failed APIs return safe messages and leave local missions usable',async()=>{
  const missing=await fixture(readConfig({}));
  try{const response=await post(missing.url,{prompt:'任務'});assert.equal(response.status,503);assert.equal((await response.json()).error.code,'NOT_CONFIGURED');}finally{await missing.close();}
  const failed=await fixture(config(),async()=>{throw new Error('test-secret');});
  try{const response=await post(failed.url,{prompt:'任務'});assert.equal(response.status,500);assert.equal((await response.text()).includes('test-secret'),false);}finally{await failed.close();}
});
