import { it } from 'node:test';
import assert from 'node:assert/strict';
import { createApiModelCatalog } from '../server/models';
import { createMissionService } from '../server/service';
import { createAiServer } from '../server/app';
import { readConfig } from '../server/config';
import { providerResponse } from './fixtures/ai';
import { once } from 'node:events';
const config=()=>readConfig({OPENAI_API_KEY:'fake-secret'});
it('loads authenticated catalog, deduplicates, caches and coalesces requests',async()=>{
  let calls=0;
  const catalog=createApiModelCatalog(config(),(async(url,options)=>{
    calls++;assert.equal(url,'https://api.openai.com/v1/models');assert.equal((options!.headers as Record<string,string>).Authorization,'Bearer fake-secret');
    return Response.json({data:[{id:'model-b'},{id:'model-a'},{id:'model-a'},{id:42}]});
  }) as typeof fetch);
  assert.deepEqual(await Promise.all([catalog.list(),catalog.list()]),[['model-a','model-b'],['model-a','model-b']]);
  await catalog.list();assert.equal(calls,1);
});
it('selected model reaches Responses while omitted model uses configured default',async()=>{
  const used:string[]=[];
  const service=createMissionService(config(),(async(_url,options)=>{used.push(JSON.parse(options!.body as string).model);return providerResponse();}) as typeof fetch);
  await service('起飛到5公尺最後降落',undefined,'chosen-model');await service('起飛到5公尺最後降落');
  assert.deepEqual(used,['chosen-model',config().model]);
});
it('HTTP lists models and rejects selections absent from the key catalog',async()=>{
  const used:(string|undefined)[]=[];
  const server=createAiServer(config(),{apiFetch:(async()=>Response.json({data:[{id:'chosen-model'}]})) as typeof fetch,parse:async(_prompt,_signal,model)=>{used.push(model);return{status:'rejected',message:'測試',questions:[],mission:null};}});
  server.listen(0,'127.0.0.1');await once(server,'listening');const base=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
  try{
    const list=await (await fetch(base+'/api/ai/models')).json();assert.deepEqual(list.models,['chosen-model']);assert.ok(!JSON.stringify(list).includes('fake-secret'));
    const send=(model:string)=>fetch(base+'/api/ai/mission',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({prompt:'起飛並降落',provider:'api_key',model})});
    assert.equal((await send('chosen-model')).status,200);assert.equal((await send('unknown-model')).status,400);assert.deepEqual(used,['chosen-model']);
  }finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
});
