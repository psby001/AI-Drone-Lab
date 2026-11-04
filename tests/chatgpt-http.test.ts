import { it } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { request as httpRequest } from 'node:http';
import { createAiServer } from '../server/app';
import { readConfig } from '../server/config';
import type { ChatGptAuth } from '../server/chatgpt/auth';
import type { ChatGptStatus } from '../src/ai/contracts';
import { exampleMission,ready } from './fixtures/ai';
const status:ChatGptStatus={enabled:true,activeId:null,accounts:[],login:{state:'idle',message:'尚未登入'}};
async function fixture(host='127.0.0.1'){
  let paidCalls=0,oauthCalls=0,loginCalls=0;
  const auth={status:async()=>status,start:async()=>{loginCalls++;return{url:'https://auth.openai.com/api/accounts/authorize?state=test'};},access:async()=>({token:'oauth-token',accountId:'id'}),cancel:async()=>{},select:async()=>{},logout:async()=>({revoked:true}),dispose(){}} as unknown as ChatGptAuth;
  const server=createAiServer({...readConfig({OPENAI_API_KEY:'paid-key'}),host},{chatgpt:auth,parse:async()=>{paidCalls++;return{status:'ready',message:'測試',questions:[],mission:exampleMission};},chatgptFetch:(async(url)=>{
    oauthCalls++;if(String(url).endsWith('/models'))return Response.json({models:[{slug:'account-model',display_name:'帳號模型',visibility:'list'}]});
    return new Response('data: '+JSON.stringify({type:'response.completed',response:{status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(ready())}]}]}})+'\n\n');
  }) as typeof fetch});
  server.listen(0,'127.0.0.1');await once(server,'listening');const url=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
  return{url,counts:()=>({paidCalls,oauthCalls,loginCalls}),close:()=>new Promise<void>(resolve=>{server.close(()=>resolve());server.closeIdleConnections();})};
}
const post=(url:string,path:string,body:unknown={},headers:Record<string,string>={})=>fetch(url+path,{method:'POST',headers:{'Content-Type':'application/json',Origin:'http://localhost:5173',...headers},body:JSON.stringify(body)});
it('retains API-key default and routes explicit ChatGPT requests without exposing credentials',async()=>{
  const f=await fixture();try{
    assert.equal((await post(f.url,'/api/ai/mission',{prompt:'任務'})).status,200);
    const response=await post(f.url,'/api/ai/mission',{prompt:'任務',provider:'chatgpt',model:'account-model'});assert.equal(response.status,200);assert.equal((await response.json()).status,'ready');
    assert.deepEqual(f.counts(),{paidCalls:1,oauthCalls:2,loginCalls:0});
    const publicStatus=await fetch(f.url+'/api/ai/chatgpt/status');assert.equal((await publicStatus.text()).includes('oauth-token'),false);
    assert.equal((await post(f.url,'/api/ai/chatgpt/login')).status,200);assert.equal(f.counts().loginCalls,1);
    assert.equal((await post(f.url,'/api/ai/mission',{prompt:'任務',provider:'chatgpt'})).status,400);
  }finally{await f.close();}
});
it('rejects remote host, forwarded peers, and missing origins for local account operations',async()=>{
  const f=await fixture();try{
    assert.equal((await post(f.url,'/api/ai/chatgpt/login',{}, {'X-AI-Client-Address':'192.168.1.2'})).status,403);
    assert.equal((await fetch(f.url+'/api/ai/chatgpt/models',{headers:{'Sec-Fetch-Site':'cross-site'}})).status,403);
    const remoteHostStatus=await new Promise<number>((resolve,reject)=>{
      const request=httpRequest(f.url+'/api/ai/mission',{method:'POST',headers:{Host:'192.168.1.10:5173',Origin:'http://localhost:5173','Content-Type':'application/json'}},response=>{response.resume();resolve(response.statusCode!);});
      request.on('error',reject);request.end(JSON.stringify({prompt:'任務',provider:'chatgpt',model:'account-model'}));
    });assert.equal(remoteHostStatus,403);
    const noOrigin=await fetch(f.url+'/api/ai/chatgpt/login',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});assert.equal(noOrigin.status,403);
    assert.equal(f.counts().loginCalls,0);assert.equal(f.counts().oauthCalls,0);
  }finally{await f.close();}
  const remote=await fixture('0.0.0.0');try{assert.equal((await post(remote.url,'/api/ai/mission',{prompt:'任務',provider:'chatgpt',model:'account-model'})).status,200);assert.equal((await post(remote.url,'/api/ai/chatgpt/login',{}, {'X-AI-Client-Address':'192.168.1.2'})).status,403);assert.equal((await post(remote.url,'/api/ai/mission',{prompt:'任務'})).status,200);}finally{await remote.close();}
});
