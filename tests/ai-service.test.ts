import { MISSION_LIMITS as Budget } from '../src/config/limits';
import { it } from 'node:test';
import assert from 'node:assert/strict';
import Ajv from 'ajv';
import { readConfig } from '../server/config';
import { createMissionService, AiError, validateAiOutput } from '../server/service';
import { aiOutputSchema } from '../server/output-schema';
import { AI_LIMITS as A, PROMPT_EXAMPLES } from '../src/ai/contracts';
import { MissionRunner } from '../src/missions/MissionRunner';
import { FlightModel } from '../src/core/flight';
import { PRESETS } from '../src/missions/presets';
import { exampleMission, providerResponse, ready } from './fixtures/ai';
const config=()=>readConfig({OPENAI_API_KEY:'test-secret-never-log'});
const fails=(code:string)=>(error:unknown)=>error instanceof AiError&&error.code===code&&!error.message.includes('test-secret');
it('derives a strict required/nullable provider schema with recursive command refs',()=>{
  const inspect=(node:any)=>{
    if(node.type==='object'){assert.equal(node.additionalProperties,false);assert.deepEqual(node.required,Object.keys(node.properties));Object.values(node.properties).forEach(inspect);}
    if(node.anyOf)node.anyOf.forEach(inspect);
    if(node.type==='array')inspect(node.items);
    if(node.$ref)assert.ok(['#/$defs/command','#/$defs/parallelCommand'].includes(node.$ref));
  };
  inspect(aiOutputSchema);Object.values(aiOutputSchema.$defs).forEach(inspect);
  const check=new Ajv({strict:false}).compile(aiOutputSchema);
  for(const preset of PRESETS){assert.ok(check(ready(preset.mission)),preset.id);assert.equal(validateAiOutput(ready(preset.mission)).status,'ready');}
});
it('sends only server credentials to Responses with strict schema, bounded tokens and no storage',async()=>{
  let calls=0;
  const service=createMissionService(config(),(async(url,init)=>{
    calls++;assert.equal(url,'https://api.openai.com/v1/responses');
    assert.equal((init!.headers as Record<string,string>).Authorization,'Bearer test-secret-never-log');
    const body=JSON.parse(init!.body as string);
    assert.equal(body.store,false);assert.equal(body.max_output_tokens,A.maxOutputTokens);
    assert.equal(body.text.format.strict,true);assert.equal(body.text.format.type,'json_schema');
    assert.equal(body.input[1].content,PROMPT_EXAMPLES[0]);assert.equal(body.tools,undefined);
    return providerResponse();
  }) as typeof fetch);
  const output=await service(PROMPT_EXAMPLES[0]);assert.equal(output.status,'ready');
  assert.deepEqual(output.mission!.commands,exampleMission.commands);assert.equal(JSON.stringify(output).includes('test-secret'),false);assert.equal(calls,1);
});
it('validates AI JSON and flies the described sample through the existing physics',async()=>{
  const result=await createMissionService(config(),(async()=>providerResponse()) as typeof fetch)(PROMPT_EXAMPLES[0]);
  const model=new FlightModel('breeze'),runner=new MissionRunner(model);
  assert.deepEqual(runner.load(result.mission),[]);assert.ok(runner.start());
  for(let i=0;i<120*180&&runner.ownsControl;i++)runner.update(1/120);
  assert.equal(runner.snapshot.status,'completed');assert.equal(model.state.mode,'grounded');
  assert.ok(Math.abs(model.state.position.east-5)<0.4);assert.ok(Math.abs(model.state.position.north-10)<0.4);
  assert.ok(Math.abs(model.state.heading-90)<1);assert.deepEqual(runner.snapshot.completed,[0,1,2,3,4]);
});
it('returns clarification without producing a flyable mission',async()=>{
  const value={status:'clarification',message:'請確認右移還是右轉。',questions:['你要向右平移幾公尺，還是右轉幾度？'],mission:null};
  const output=await createMissionService(config(),(async()=>providerResponse(value)) as typeof fetch)('往右一點');
  assert.deepEqual(output,value);
  assert.throws(()=>validateAiOutput({...value,mission:ready().mission}),fails('INVALID_OUTPUT'));
  assert.throws(()=>validateAiOutput({...value,questions:[]}),fails('INVALID_OUTPUT'));
});
it('rejects unsafe AI routes, oversized repeat expansion and unsupported actions',()=>{
  const unsafe=[{...exampleMission,commands:[{action:'takeoff',altitude:21},{action:'land'}]},
    {commands:[{action:'takeoff',altitude:3},{action:'repeat',count:4,commands:Array(Math.floor((Budget.maxCommands-2)/4)+1).fill({action:'hover',duration:1})},{action:'land'}]}];
  for(const mission of unsafe)assert.throws(()=>validateAiOutput(ready(mission as any)),fails('INVALID_MISSION'));
  const invalid=ready();(invalid.mission as any).commands[1].action='execute_python';
  assert.throws(()=>validateAiOutput(invalid),fails('INVALID_OUTPUT'));
  const missingHome=ready({commands:[{action:'takeoff',altitude:3},{action:'goto_gps',latitude:0,longitude:0,altitude:3},{action:'land'}]});
  assert.throws(()=>validateAiOutput(missingHome),fails('INVALID_MISSION'));
});
it('rejects missing key, invalid input and excessive length without calling OpenAI',async()=>{
  let calls=0;const service=createMissionService(readConfig({}),(async()=>{calls++;return providerResponse();}) as typeof fetch);
  await assert.rejects(service('任務'),fails('NOT_CONFIGURED'));
  await assert.rejects(service(' '),fails('INVALID_INPUT'));await assert.rejects(service('飛'.repeat(1001)),fails('INPUT_TOO_LONG'));assert.equal(calls,0);
});
it('handles provider auth, rate, availability and network errors without leaking details or retrying',async()=>{
  for(const [status,code] of [[401,'PROVIDER_AUTH'],[403,'PROVIDER_AUTH'],[429,'PROVIDER_RATE_LIMIT'],[500,'PROVIDER_ERROR'],[400,'MODEL_UNSUPPORTED']] as const){
    let calls=0;await assert.rejects(createMissionService(config(),(async()=>{calls++;return new Response('test-secret-never-log',{status});}) as typeof fetch)('起飛到3公尺最後降落'),fails(code));assert.equal(calls,1);
  }
  await assert.rejects(createMissionService(config(),(async()=>{throw new Error('test-secret-never-log');}) as typeof fetch)('飛行'),fails('NETWORK_ERROR'));
});
it('handles timeout and client cancellation',async()=>{
  const stuck=(async(_url,options)=>new Promise((_resolve,reject)=>{
    options!.signal!.addEventListener('abort',()=>reject(new Error('aborted')),{once:true});
  })) as typeof fetch;
  // Keep an event-loop handle while testing AbortSignal.timeout's unref timer.
  const keepAlive=setInterval(()=>{},1000);
  try{
    await assert.rejects(createMissionService({...config(),timeoutMs:100},stuck)('飛行'),fails('TIMEOUT'));
    const controller=new AbortController(),promise=createMissionService(config(),stuck)('飛行',controller.signal);controller.abort();
    await assert.rejects(promise,fails('CANCELLED'));
  }finally{clearInterval(keepAlive);}
});
it('rejects malformed, incomplete, refused, excessive and non-JSON outputs',async()=>{
  for(const [value,code] of [
    [{status:'incomplete',output:[]},'INCOMPLETE_OUTPUT'],
    [{status:'completed',output:[{type:'message',content:[{type:'refusal',refusal:'no'}]}]},'REFUSED'],
    [{status:'completed',output:[{type:'message',content:[{type:'output_text',text:'not json'}]}]},'INVALID_OUTPUT'],
    [{status:'completed',output:[]},'INVALID_OUTPUT'],
  ] as const){await assert.rejects(createMissionService(config(),(async()=>new Response(JSON.stringify(value))) as typeof fetch)('飛行'),fails(code));}
  await assert.rejects(createMissionService(config(),(async()=>new Response('{')) as typeof fetch)('飛行'),fails('INVALID_OUTPUT'));
  await assert.rejects(createMissionService(config(),(async()=>new Response('x'.repeat(A.maxProviderBytes+1))) as typeof fetch)('飛行'),fails('INVALID_OUTPUT'));
});
