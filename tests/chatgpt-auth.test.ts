import { it } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';
import { ChatGptAuth } from '../server/chatgpt/auth';
import type { CredentialStore, ChatGptData } from '../server/chatgpt/store';
class MemoryStore implements CredentialStore {
  data:ChatGptData|null=null;
  async load(){return structuredClone(this.data);}
  async save(data:ChatGptData){this.data=structuredClone(data);}
}
async function fixture(options:{badNonce?:boolean;badAudience?:boolean;badIssuer?:boolean;badSignature?:boolean;expired?:boolean;noSharing?:boolean;failRefresh?:boolean;failRevoke?:boolean}={}){
  const store=new MemoryStore(),{privateKey,publicKey}=await generateKeyPair('RS256');
  const jwk={...await exportJWK(publicKey),kid:'fixture',alg:'RS256',use:'sig'};
  const authUrls:URL[]=[];let now=Date.now(),refreshCalls=0,exchangeCalls=0,revokeCalls=0;
  const scopes='openid profile email offline_access resource.invoke'+(options.noSharing?'':' chatgpt.tokens.use.direct');
  const fetcher=(async(url,init)=>{
    const target=String(url);
    if(target.endsWith('/.well-known/openid-configuration'))return Response.json({issuer:'https://auth.openai.com',jwks_uri:'https://auth.openai.com/.well-known/jwks.json',revocation_endpoint:'https://auth.openai.com/api/accounts/oauth/revoke'});
    if(target.endsWith('/.well-known/jwks.json'))return Response.json({keys:[jwk]});
    if(target.endsWith('/oauth/revoke')){revokeCalls++;assert.equal((init!.body as URLSearchParams).get('client_id'),'issued-client');return new Response(null,{status:options.failRevoke?503:200});}
    if(target.endsWith('/oauth/token')){
      const body=init!.body as URLSearchParams;assert.equal(body.get('client_id'),'issued-client');assert.equal(body.get('resource'),'https://api.openai.com/v1');
      if(body.get('grant_type')==='refresh_token'){
        refreshCalls++;if(options.failRefresh)return Response.json({error:'invalid_grant'},{status:400});
        assert.equal(body.has('scope'),false);return Response.json({access_token:'renewed-access',refresh_token:'renewed-refresh',token_type:'Bearer',expires_in:3600,scope:scopes});
      }
      exchangeCalls++;const authorization=authUrls.at(-1)!;
      assert.equal(body.get('redirect_uri'),authorization.searchParams.get('redirect_uri'));
      assert.equal(createHash('sha256').update(body.get('code_verifier')!).digest('base64url'),authorization.searchParams.get('code_challenge'));
      let token=await new SignJWT({nonce:options.badNonce?'bad':authorization.searchParams.get('nonce'),email:'student@example.test'})
        .setProtectedHeader({alg:'RS256',kid:'fixture'}).setSubject('verified-student').setIssuer(options.badIssuer?'https://evil.test':'https://auth.openai.com')
        .setAudience(options.badAudience?'wrong-client':'issued-client').setIssuedAt().setExpirationTime(options.expired?'0s':'1h').sign(privateKey);
      if(options.badSignature){const pieces=token.split('.');pieces[2]=(pieces[2][0]==='A'?'B':'A')+pieces[2].slice(1);token=pieces.join('.');}
      return Response.json({id_token:token,access_token:'protected-access',refresh_token:'protected-refresh',token_type:'Bearer',expires_in:3600,scope:scopes});
    }
    throw new Error('Unexpected endpoint');
  }) as typeof fetch;
  const auth=new ChatGptAuth(store,{fetcher,clock:()=>now});
  const start=async(accountId?:string)=>{const {url}=await auth.start(accountId);const parsed=new URL(url);authUrls.push(parsed);return parsed;};
  const callback=async(authorization:URL,changes:Record<string,string>={})=>{
    const callback=new URL(authorization.searchParams.get('redirect_uri')!);callback.searchParams.set('state',authorization.searchParams.get('state')!);callback.searchParams.set('code','fixture-code');callback.searchParams.set('client_id','issued-client');
    Object.entries(changes).forEach(([key,value])=>callback.searchParams.set(key,value));return fetch(callback);
  };
  return{auth,store,start,callback,advance:()=>{now+=3590000;},counts:()=>({refreshCalls,exchangeCalls,revokeCalls})};
}
it('completes real signed OIDC validation, PKCE exchange and stores tokens only behind a redacted status',async()=>{
  const f=await fixture();try{
    const url=await f.start();assert.equal(url.origin,'https://auth.openai.com');assert.equal(url.searchParams.get('client_id'),'dynamic_agent_client');assert.equal(url.searchParams.get('agent_name_hint'),'AI Drone Lab');assert.match(url.searchParams.get('scope')!,/chatgpt.tokens.use.direct/);
    assert.equal((await f.callback(url)).status,200);const status=await f.auth.status();assert.equal(status.login.state,'completed');assert.equal(status.accounts[0].sharing,true);
    assert.equal(JSON.stringify(status).includes('protected-access'),false);assert.equal(JSON.stringify(status).includes('protected-refresh'),false);
    assert.equal((await f.auth.access()).token,'protected-access');assert.equal(f.store.data!.profiles[0].clientId,'issued-client');
    assert.equal(f.store.data!.profiles[0].subject,'verified-student');assert.equal(f.counts().exchangeCalls,1);
  }finally{f.auth.dispose();}
});
it('rejects mismatched or unicode state without exchanging credentials and allows the valid callback',async()=>{
  const f=await fixture();try{const url=await f.start();assert.equal((await f.callback(url,{state:'壞'.repeat(43)})).status,400);assert.equal(f.counts().exchangeCalls,0);assert.equal((await f.callback(url)).status,200);}finally{f.auth.dispose();}
});
for(const option of ['badNonce','badAudience','badIssuer','badSignature','expired'] as const)it(`rejects ${option} ID tokens`,async()=>{
  const f=await fixture({[option]:true});try{const url=await f.start();assert.equal((await f.callback(url)).status,400);assert.equal((await f.auth.status()).login.state,'failed');await assert.rejects(f.auth.access());}finally{f.auth.dispose();}
});
it('does not exchange denied consent, rejects changed client IDs and supports cancellation',async()=>{
  const f=await fixture();try{
    let url=await f.start();assert.equal((await f.callback(url,{error:'access_denied'})).status,400);assert.equal(f.counts().exchangeCalls,0);
    url=await f.start();assert.equal((await f.callback(url)).status,200);const id=(await f.auth.status()).activeId!;
    url=await f.start(id);assert.equal(url.searchParams.get('client_id'),'issued-client');assert.equal(url.searchParams.has('agent_name_hint'),false);assert.equal(url.searchParams.has('id_token_hint'),false);
    assert.equal((await f.callback(url,{client_id:'different-client'})).status,400);assert.equal(f.counts().exchangeCalls,1);
    await f.start(id);await f.auth.cancel();assert.equal((await f.auth.status()).login.state,'idle');
  }finally{f.auth.dispose();}
});
it('identity-only consent is not allowed to run ChatGPT inference',async()=>{
  const f=await fixture({noSharing:true});try{const url=await f.start();await f.callback(url);assert.equal((await f.auth.status()).accounts[0].sharing,false);await assert.rejects(f.auth.access(),/尚未授權/);}finally{f.auth.dispose();}
});
it('serializes rotating refreshes and reuses the issued registration after logout',async()=>{
  const f=await fixture();try{
    await f.callback(await f.start());const before=f.store.data!,id=before.activeId!,host=before.hostId;f.advance();
    const tokens=await Promise.all([f.auth.access(),f.auth.access(),f.auth.access()]);assert.ok(tokens.every(t=>t.token==='renewed-access'));assert.equal(f.counts().refreshCalls,1);assert.equal(f.store.data!.profiles[0].refreshToken,'renewed-refresh');
    assert.deepEqual(await f.auth.logout(),{revoked:true});assert.equal(f.store.data!.profiles[0].accessToken,undefined);assert.equal(f.store.data!.profiles[0].clientId,'issued-client');
    const url=await f.start(id);assert.equal(url.searchParams.get('client_id'),'issued-client');assert.equal(url.searchParams.get('ext_agent_host_id'),host);assert.equal(url.searchParams.has('id_token_hint'),false);
  }finally{f.auth.dispose();}
});
it('refresh errors require re-login and failed remote revocation still clears local tokens',async()=>{
  const f=await fixture({failRefresh:true,failRevoke:true});try{
    await f.callback(await f.start());f.advance();await assert.rejects(f.auth.access(),/重新登入/);
    assert.deepEqual(await f.auth.logout(),{revoked:false});assert.equal(f.store.data!.profiles[0].refreshToken,undefined);assert.match((await f.auth.status()).login.message,/無法確認遠端撤銷/);assert.equal(f.counts().revokeCalls,2);
  }finally{f.auth.dispose();}
});
