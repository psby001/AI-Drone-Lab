import { it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir,mkdtemp,readFile,unlink,rmdir } from 'node:fs/promises';
import { resolve,join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { LocalCredentialStore, type ChatGptData } from '../server/chatgpt/store';
it('persists credentials atomically and uses Windows current-user DPAPI protection',async()=>{
  const parent=resolve('server/.local');await mkdir(parent,{recursive:true});const dir=await mkdtemp(join(parent,'storage-test-'));
  assert.ok(dir.startsWith(parent));
  try{
    const store=new LocalCredentialStore(dir);assert.equal(await store.load(),null);
    const data:ChatGptData={version:1,hostId:`urn:uuid:${randomUUID()}`,activeId:'account',profiles:[{id:'account',clientId:'issued',label:'測試帳號',accessToken:'dummy-token-not-a-real-secret',scopes:['chatgpt.tokens.use.direct']}]};
    await store.save(data);assert.deepEqual(await store.load(),data);
    if(process.platform==='win32')assert.equal((await readFile(join(dir,'credentials.dat'))).includes(Buffer.from('dummy-token-not-a-real-secret')),false);
    delete data.profiles[0].accessToken;await store.save(data);assert.deepEqual(await store.load(),data);
  }finally{await unlink(join(dir,'credentials.dat')).catch(()=>{});await unlink(join(dir,'credentials.tmp')).catch(()=>{});await rmdir(dir);}
});
