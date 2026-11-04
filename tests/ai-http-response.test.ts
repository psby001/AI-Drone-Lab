import { it } from 'node:test';
import assert from 'node:assert/strict';
import { AiClientError,readAiResponse } from '../src/ai/http';
import { readConfig } from '../server/config';
it('explains HTML and proxy errors instead of exposing JSON parser exceptions',async()=>{
  for(const [status,type,body] of [[200,'text/html','<!doctype html><html>SPA fallback</html>'],[502,'text/plain','ECONNREFUSED']] as const){
    await assert.rejects(readAiResponse(new Response(body,{status,headers:{'Content-Type':type}})),error=>error instanceof AiClientError&&/pnpm dev/.test(error.message)&&!error.message.includes('Unexpected token')&&!error.message.includes(body));
  }
});
it('handles malformed JSON and preserves safe backend validation messages',async()=>{
  await assert.rejects(readAiResponse(new Response('{',{headers:{'Content-Type':'application/json'}})),/資料不完整/);
  await assert.rejects(readAiResponse(Response.json({error:{message:'未通過飛行驗證',details:['高度超過20m']}},{status:422})),error=>error instanceof AiClientError&&error.message==='未通過飛行驗證'&&error.details[0]==='高度超過20m');
  assert.deepEqual(await readAiResponse(Response.json({configured:true})),{configured:true});
});
it('allows the actual loopback frontend port chosen by the development launcher',()=>{
  const config=readConfig({AI_DEV_FRONTEND_PORT:'5174'});
  assert.ok(config.origins.includes('http://127.0.0.1:5174'));assert.ok(config.origins.includes('http://localhost:5174'));
  assert.throws(()=>readConfig({AI_DEV_FRONTEND_PORT:'invalid'}));
});
