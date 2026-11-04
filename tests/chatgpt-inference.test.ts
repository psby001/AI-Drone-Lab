import { it } from 'node:test';
import assert from 'node:assert/strict';
import { createChatGptInference,readCompletedStream } from '../server/chatgpt/inference';
import { readConfig } from '../server/config';
import type { ChatGptAuth } from '../server/chatgpt/auth';
import { ready,exampleMission } from './fixtures/ai';
import { AI_LIMITS as A } from '../src/ai/contracts';
const auth={access:async()=>({token:'oauth-only',accountId:'local-account'})} as ChatGptAuth;
const completed=(value:unknown=ready())=>({type:'response.completed',response:{status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(value)}]}]}});
const sse=(events:unknown[])=>new Response(events.map(event=>'data: '+JSON.stringify(event)+'\n\n').join(''),{headers:{'Content-Type':'text/event-stream'}});
it('uses account-specific models, instructions, stream:true, and never sends API-key-only fields',async()=>{
  let calls=0;const inference=createChatGptInference(readConfig({OPENAI_API_KEY:'paid-key'}),auth,(async(url,options)=>{
    calls++;assert.equal((options!.headers as Record<string,string>).Authorization,'Bearer oauth-only');
    if(String(url).endsWith('/models'))return Response.json({models:[{slug:'available',display_name:'帳號模型',visibility:'list'},{slug:'hidden',visibility:'hidden'}]});
    const body=JSON.parse(options!.body as string);assert.equal(body.stream,true);assert.equal(body.store,false);assert.ok(body.instructions);assert.equal(body.input.length,1);assert.equal(body.input[0].role,'user');assert.equal(body.max_output_tokens,undefined);assert.equal(body.text.format.strict,true);
    return sse([{type:'response.output_text.delta',delta:'not yet a mission'},completed()]);
  }) as typeof fetch);
  const output=await inference.parse('起飛到5公尺，前進10公尺，右轉90度，再前進5公尺，降落。','available');
  assert.deepEqual(output.mission!.commands,exampleMission.commands);assert.equal(calls,2);
  await assert.rejects(inference.parse('飛行','hidden'),/目前 ChatGPT 帳號/);
});
it('rejects a usage-limit failure after deltas, incomplete output and disconnected streams',async()=>{
  for(const events of [
    [{type:'response.output_text.delta',delta:'{}'},{type:'response.failed',response:{error:{code:'subscription_sharing_usage_limit_exceeded'}}}],
    [{type:'response.incomplete'}],
    [{type:'response.output_text.delta',delta:'{}'}],
    [{type:'response.completed',response:{status:'failed'}}],
  ])await assert.rejects(readCompletedStream(sse(events)));
});
it('reads SSE fragmented across bytes and CRLF boundaries and rejects oversized output',async()=>{
  const raw=new TextEncoder().encode('data: '+JSON.stringify(completed())+'\r\n\r\n');
  const stream=new ReadableStream<Uint8Array>({start(controller){for(let i=0;i<raw.length;i+=3)controller.enqueue(raw.slice(i,i+3));controller.close();}});
  assert.equal((await readCompletedStream(new Response(stream)) as any).status,'completed');
  await assert.rejects(readCompletedStream(new Response('x'.repeat(A.maxStreamEventBytes+1))),/讀取上限/);
});
it('never retries or falls back to a paid API key when ChatGPT fails',async()=>{
  let responses=0;
  const inference=createChatGptInference(readConfig({OPENAI_API_KEY:'paid-key'}),auth,(async(url)=>{
    if(String(url).endsWith('/models'))return Response.json({models:[{slug:'m',visibility:'list'}]});responses++;return new Response(null,{status:429});
  }) as typeof fetch);
  await assert.rejects(inference.parse('飛行','m'),/不會自動改用 API Key/);assert.equal(responses,1);
});
it('applies the existing safety validator to ChatGPT completed output',async()=>{
  const inference=createChatGptInference(readConfig({}),auth,(async(url)=>String(url).endsWith('/models')?Response.json({models:[{slug:'m',visibility:'list'}]}):sse([completed(ready({commands:[{action:'takeoff',altitude:100},{action:'land'}]}))])) as typeof fetch);
  await assert.rejects(inference.parse('起飛100公尺，降落','m'),/安全驗證/);
});
it('accepts a model catalog larger than the mission limit and only returns compact model choices',async()=>{
  const catalog={models:[{slug:'available',display_name:'帳號模型',visibility:'list',metadata:'x'.repeat(400000)}]};
  const inference=createChatGptInference(readConfig({}),auth,(async()=>Response.json(catalog)) as typeof fetch);
  assert.deepEqual(await inference.models(),[{slug:'available',displayName:'帳號模型'}]);
});
it('rejects an excessive catalog with a model-specific error rather than asking to shorten a mission',async()=>{
  const inference=createChatGptInference(readConfig({}),auth,(async()=>Response.json({models:[],metadata:'x'.repeat(A.maxModelCatalogBytes)})) as typeof fetch);
  await assert.rejects(inference.models(),(error:any)=>error.code==='CHATGPT_MODELS_TOO_LARGE'&&/模型清單/.test(error.message)&&!/縮短任務/.test(error.message));
});
it('allows verbose stream transport for a small completed task while retaining a total stream cap',async()=>{
  const deltas=Array.from({length:1200},()=>({type:'response.output_text.delta',delta:'x'.repeat(300)}));
  assert.equal((await readCompletedStream(sse([...deltas,completed()])) as any).status,'completed');
  const excessive=Array.from({length:8500},()=>({type:'response.output_text.delta',delta:'x'.repeat(1000)}));
  await assert.rejects(readCompletedStream(sse(excessive)),/串流資料超過讀取上限/);
});
it('still rejects an oversized final mission despite a larger transport allowance',async()=>{
  const output={...ready(),message:'x'.repeat(A.maxProviderBytes+1)};
  const inference=createChatGptInference(readConfig({}),auth,(async(url)=>String(url).endsWith('/models')?Response.json({models:[{slug:'m',visibility:'list'}]}):sse([completed(output)])) as typeof fetch);
  await assert.rejects(inference.parse('飛行','m'),/任務 JSON 過大/);
});
const finishedItem=(value:unknown=ready(),index=0)=>({type:'response.output_item.done',output_index:index,item:{id:`msg_${index}`,type:'message',status:'completed',role:'assistant',content:[{type:'output_text',text:JSON.stringify(value)}]}});
it('rebuilds an empty or omitted terminal output only from finalized items after successful completion',async()=>{
  for(const output of [[],null,undefined]){
    const terminal={type:'response.completed',response:{status:'completed',...(output===undefined?{}:{output})}};
    const inference=createChatGptInference(readConfig({}),auth,(async(url)=>String(url).endsWith('/models')?Response.json({models:[{slug:'m',visibility:'list'}]}):sse([{type:'response.output_text.delta',delta:'ignore this partial text'},finishedItem(),terminal])) as typeof fetch);
    assert.deepEqual((await inference.parse('起飛到5公尺，前進10公尺，右轉90度，再前進5公尺，降落。','m')).mission!.commands,exampleMission.commands);
  }
});
it('never accepts finalized items without a completed response or after a late failure',async()=>{
  await assert.rejects(readCompletedStream(sse([finishedItem()])),/未收到完成確認/);
  await assert.rejects(readCompletedStream(sse([finishedItem(),{type:'response.failed',response:{error:{code:'subscription_sharing_usage_limit_exceeded'}}}])),/用量已達上限/);
  await assert.rejects(readCompletedStream(sse([finishedItem(),{type:'response.incomplete'}])),/截斷/);
  const incomplete=finishedItem();incomplete.item.status='incomplete';await assert.rejects(readCompletedStream(sse([incomplete,{type:'response.completed',response:{status:'completed',output:[]}}])),/未完整完成/);
});
it('ignores added items and text deltas when the terminal envelope is empty',async()=>{
  const inference=createChatGptInference(readConfig({}),auth,(async(url)=>String(url).endsWith('/models')?Response.json({models:[{slug:'m',visibility:'list'}]}):sse([{...finishedItem(),type:'response.output_item.added'},{type:'response.output_text.delta',delta:JSON.stringify(ready())},{type:'response.completed',response:{status:'completed',output:[]}}])) as typeof fetch);
  await assert.rejects(inference.parse('飛行','m'),/沒有可驗證的完整任務文字/);
});
it('still validates safety and refusals when reconstructing finalized output',async()=>{
  for(const item of [finishedItem(ready({commands:[{action:'takeoff',altitude:100},{action:'land'}]})),{...finishedItem(),item:{...finishedItem().item,content:[{type:'refusal',refusal:'no'}]}}]){
    const inference=createChatGptInference(readConfig({}),auth,(async(url)=>String(url).endsWith('/models')?Response.json({models:[{slug:'m',visibility:'list'}]}):sse([item,{type:'response.completed',response:{status:'completed',output:[]}}])) as typeof fetch);
    await assert.rejects(inference.parse('飛行','m'));
  }
});
it('shows safe upstream codes and fields without exposing the raw provider message',async()=>{
  const inference=createChatGptInference(readConfig({}),auth,(async(url)=>String(url).endsWith('/models')?Response.json({models:[{slug:'m',visibility:'list'}]}):Response.json({error:{code:'invalid_json_schema',param:'text.format.schema',message:'sensitive raw provider text'}},{status:400})) as typeof fetch);
  await assert.rejects(inference.parse('飛行','m'),(error:any)=>error.code==='CHATGPT_REQUEST_REJECTED'&&error.details.includes('OpenAI 錯誤碼：invalid_json_schema')&&error.details.includes('欄位：text.format.schema')&&!JSON.stringify(error).includes('sensitive'));
});
