import { createServer, type Server } from 'node:http';
import { randomBytes, randomUUID, createHash, timingSafeEqual } from 'node:crypto';
import { createRemoteJWKSet, customFetch, jwtVerify, type JWTPayload } from 'jose';
import { AiError } from '../service';
import type { CredentialStore, ChatGptData, ChatGptProfile } from './store';
import type { ChatGptStatus } from '../../src/ai/contracts';
const ISSUER='https://auth.openai.com',RESOURCE='https://api.openai.com/v1';
const SCOPES='openid profile email offline_access resource.invoke chatgpt.tokens.use.direct';
const same=(a:string,b:string)=>{const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length&&timingSafeEqual(x,y);};
const opaque=()=>randomBytes(32).toString('base64url');
interface Metadata { issuer:string;jwks_uri:string;revocation_endpoint:string }
type Verify=(token:string,clientId:string,nonce?:string)=>Promise<JWTPayload>;
interface Dependencies { fetcher?:typeof fetch;verify?:Verify;clock?:()=>number }
export class ChatGptAuth {
  private data!:ChatGptData;
  private initialized:Promise<void>|null=null;
  private refresh:Promise<void>|null=null;
  private mutation:Promise<unknown>=Promise.resolve();
  private operations=0;
  private listener:Server|null=null;
  private timer:ReturnType<typeof setTimeout>|null=null;
  private pending:{state:string;nonce:string;verifier:string;redirectUri:string;accountId?:string;clientId?:string}|null=null;
  private login:ChatGptStatus['login']={state:'idle',message:'尚未登入 ChatGPT'};
  private metadata:Promise<Metadata>|null=null;
  private jwks:ReturnType<typeof createRemoteJWKSet>|null=null;
  private fetcher:typeof fetch;private clock:()=>number;private verify:Verify;
  constructor(private store:CredentialStore,deps:Dependencies={}){
    this.fetcher=deps.fetcher??fetch;this.clock=deps.clock??(()=>Date.now());
    this.verify=deps.verify??(async(token,clientId,nonce)=>{
      const meta=await this.discovery();
      this.jwks??=createRemoteJWKSet(new URL(meta.jwks_uri),{[customFetch]:this.fetcher});
      const {payload}=await jwtVerify(token,this.jwks,{issuer:ISSUER,audience:clientId,algorithms:['RS256'],requiredClaims:['sub','exp','iat']});
      if(nonce!==undefined&&(typeof payload.nonce!=='string'||!same(payload.nonce,nonce)))throw new Error('Invalid nonce');
      return payload;
    });
  }
  private async init(){
    if(!this.initialized)this.initialized=(async()=>{
      try{this.data=await this.store.load()??{version:1,hostId:`urn:uuid:${randomUUID()}`,activeId:null,profiles:[]};await this.store.save(this.data);}
      catch{throw new AiError(503,'CHATGPT_STORAGE','無法讀取或保護本機 ChatGPT 憑證，請檢查本機資料目錄。');}
    })();
    await this.initialized;
  }
  private async persist(){try{await this.store.save(this.data);}catch{throw new AiError(503,'CHATGPT_STORAGE','無法安全保存 ChatGPT 連線，請檢查本機儲存權限。');}}
  private async discovery():Promise<Metadata>{
    if(!this.metadata)this.metadata=(async()=>{
      const response=await this.fetcher(`${ISSUER}/.well-known/openid-configuration`,{signal:AbortSignal.timeout(10000),redirect:'error'});
      if(!response.ok)throw new Error('Discovery unavailable');
      const meta=await response.json() as Metadata;
      if(meta.issuer!==ISSUER||[meta.jwks_uri,meta.revocation_endpoint].some(value=>{const u=new URL(value);return u.origin!==ISSUER||u.username||u.password;}))throw new Error('Invalid discovery');
      return meta;
    })().catch(error=>{this.metadata=null;throw error;});
    return this.metadata;
  }
  private async exclusive<T>(action:()=>Promise<T>):Promise<T>{
    this.operations++;
    const next=this.mutation.then(action,action);this.mutation=next.catch(()=>{});
    try{return await next;}finally{this.operations--;}
  }
  async status():Promise<ChatGptStatus>{
    await this.init();return {enabled:true,activeId:this.data.activeId,accounts:this.data.profiles.map(p=>({id:p.id,label:p.label,connected:Boolean(p.accessToken),sharing:Boolean(p.accessToken&&p.scopes.includes('chatgpt.tokens.use.direct'))})),login:{...this.login}};
  }
  async start(accountId?:string):Promise<{url:string}>{
    return this.exclusive(async()=>{
      await this.init();if(this.refresh)await this.refresh;
      if(this.pending)throw new AiError(409,'LOGIN_PENDING','已有登入流程，請先完成或取消。');
      const profile=accountId?this.data.profiles.find(p=>p.id===accountId):undefined;
      if(accountId&&!profile)throw new AiError(400,'ACCOUNT_NOT_FOUND','找不到選定帳號，請新增連線。');
      if(!profile&&this.data.profiles.length>=20)throw new AiError(400,'ACCOUNT_LIMIT','本機最多保留 20 個帳號註冊。');
      const state=opaque(),nonce=opaque(),verifier=opaque();
      const listener=createServer((req,res)=>{
        res.setHeader('Cache-Control','no-store');res.setHeader('Content-Security-Policy',"default-src 'none'; frame-ancestors 'none'");res.setHeader('Referrer-Policy','no-referrer');
        let url:URL;try{url=new URL(req.url??'/', 'http://127.0.0.1');}catch{res.writeHead(400);res.end();return;}
        const pending=this.pending;
        if(req.method!=='GET'||url.pathname!=='/auth/callback'||!pending||this.login.state!=='pending'||!same(url.searchParams.get('state')??'',pending.state)){res.writeHead(400);res.end('Invalid or expired sign-in.');return;}
        this.login={state:'processing',message:'正在驗證 OpenAI 登入與用量權限…'};
        void this.finish(url,pending).then(()=>{
          res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end('<!doctype html><meta charset="utf-8"><title>AI Drone Lab</title><p>ChatGPT 授權處理完成，請返回 AI Drone Lab 查看連線狀態。可以關閉此頁。</p>');
        }).catch(()=>{
          res.writeHead(400,{'Content-Type':'text/html; charset=utf-8'});res.end('<!doctype html><meta charset="utf-8"><p>登入未完成，請返回 AI Drone Lab 查看提示並重試。</p>');
        });
      });
      await new Promise<void>((resolve,reject)=>{listener.once('error',reject);listener.listen(0,'127.0.0.1',resolve);});
      this.listener=listener;
      const redirectUri=`http://127.0.0.1:${(listener.address() as {port:number}).port}/auth/callback`;
      this.pending={state,nonce,verifier,redirectUri,...(profile?{accountId:profile.id,clientId:profile.clientId}:{})};
      this.login={state:'pending',message:'請在 OpenAI 頁面登入並允許使用 ChatGPT 方案額度。'};
      this.timer=setTimeout(()=>{if(this.login.state==='pending'){this.login={state:'failed',message:'登入已逾時，請重新開始。'};this.clearAttempt();}},300000);this.timer.unref();
      const url=new URL(`${ISSUER}/api/accounts/authorize`);
      const params:Record<string,string>={client_id:profile?.clientId??'dynamic_agent_client',ext_agent_host_id:this.data.hostId,response_type:'code',redirect_uri:redirectUri,scope:SCOPES,resource:RESOURCE,state,nonce,code_challenge_method:'S256',code_challenge:createHash('sha256').update(verifier).digest('base64url')};
      if(!profile)params.agent_name_hint='AI Drone Lab';
      // Do not expose a retained ID token to the browser as an authorization hint.
      Object.entries(params).forEach(([key,value])=>url.searchParams.set(key,value));return{url:url.href};
    });
  }
  private async finish(url:URL,pending:NonNullable<ChatGptAuth['pending']>){
    try{
      if(url.searchParams.has('error'))throw new AiError(403,'CONSENT_DENIED','未完成 ChatGPT 授權，請重新登入；API Key 模式仍可使用。');
      const issued=url.searchParams.get('client_id')??pending.clientId;
      if(!issued||issued==='dynamic_agent_client'||issued.length>300||(pending.clientId&&issued!==pending.clientId))throw new AiError(400,'INVALID_CLIENT','OpenAI 帳號註冊不完整或不一致，請重新登入。');
      const code=url.searchParams.get('code');if(!code||code.length>8192)throw new Error('Missing code');
      // Retain issued registration even if the code expires; never reuse dynamic_agent_client in exchange.
      let profile=pending.accountId?this.data.profiles.find(p=>p.id===pending.accountId):this.data.profiles.find(p=>p.clientId===issued);
      if(!profile){profile={id:randomUUID(),clientId:issued,label:`ChatGPT 帳號 ${this.data.profiles.length+1}`,scopes:[]};this.data.profiles.push(profile);await this.persist();}
      const response=await this.fetcher(`${ISSUER}/api/accounts/oauth/token`,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'authorization_code',client_id:issued,code,code_verifier:pending.verifier,redirect_uri:pending.redirectUri,resource:RESOURCE}),signal:AbortSignal.timeout(15000),redirect:'error'});
      if(!response.ok)throw new AiError(401,'TOKEN_EXCHANGE','OpenAI 授權碼交換失敗或已過期，請選原帳號重新登入。');
      const token=await response.json();const identity=await this.verify(token.id_token,issued,pending.nonce);
      if(!identity.sub||(profile.subject&&profile.subject!==identity.sub))throw new Error('Identity mismatch');
      const updated=this.tokenProfile(profile,token);
      updated.subject=identity.sub;updated.label=typeof identity.email==='string'?identity.email:typeof identity.name==='string'?identity.name:profile.label;
      if(this.pending!==pending)throw new Error('Sign-in cancelled');
      Object.assign(profile,updated);this.data.activeId=profile.id;await this.persist();
      this.login={state:'completed',message:profile.scopes.includes('chatgpt.tokens.use.direct')?'ChatGPT 已連線，使用此帳號的方案額度。':'已登入，但尚未授權 ChatGPT 方案用量，請重新授權。'};
    }catch(error){
      this.login={state:'failed',message:error instanceof AiError?error.message:'無法驗證 ChatGPT 登入，請重新開始；沒有改用 API Key。'};throw error;
    }finally{this.clearAttempt();}
  }
  private tokenProfile(profile:ChatGptProfile,token:any):ChatGptProfile{
    if(typeof token.access_token!=='string'||!token.access_token||typeof token.token_type!=='string'||token.token_type.toLowerCase()!=='bearer'||!Number.isFinite(token.expires_in)||token.expires_in<=0||token.expires_in>86400)throw new Error('Invalid tokens');
    const scopes=typeof token.scope==='string'?token.scope.split(/\s+/).filter(Boolean):profile.scopes;
    return {...profile,accessToken:token.access_token,refreshToken:typeof token.refresh_token==='string'?token.refresh_token:profile.refreshToken,idToken:typeof token.id_token==='string'?token.id_token:profile.idToken,expiresAt:this.clock()+token.expires_in*1000,scopes};
  }
  private clearAttempt(){if(this.timer)clearTimeout(this.timer);this.timer=null;this.pending=null;this.listener?.close();this.listener=null;}
  async cancel(){
    if(this.login.state==='processing')throw new AiError(409,'LOGIN_PROCESSING','正在驗證登入，請稍候。');
    this.clearAttempt();this.login={state:'idle',message:'已取消登入。'};
  }
  async select(id:string){return this.exclusive(async()=>{await this.init();if(this.pending)throw new AiError(409,'LOGIN_PENDING','請先完成或取消登入。');if(this.refresh)await this.refresh;if(!this.data.profiles.some(p=>p.id===id))throw new AiError(400,'ACCOUNT_NOT_FOUND','找不到帳號。');this.data.activeId=id;await this.persist();});}
  async access():Promise<{token:string;accountId:string}>{
    await this.init();if(this.pending||this.operations)throw new AiError(409,'LOGIN_PENDING','請先完成帳號連線操作或取消登入。');const p=this.data.profiles.find(p=>p.id===this.data.activeId);
    if(!p?.accessToken)throw new AiError(401,'CHATGPT_SIGN_IN','請先登入自己的 ChatGPT 帳號。');
    if((p.expiresAt??0)<this.clock()+60000){
      if(!this.refresh)this.refresh=this.renew(p).finally(()=>{this.refresh=null;});await this.refresh;
    }
    if(!p.accessToken||!p.scopes.includes('chatgpt.tokens.use.direct')||!p.scopes.includes('resource.invoke'))throw new AiError(403,'CHATGPT_PERMISSION','尚未授權 ChatGPT 方案用量，請重新登入並授權。');
    return{token:p.accessToken,accountId:p.id};
  }
  private async renew(profile:ChatGptProfile){
    if(!profile.refreshToken)throw new AiError(401,'CHATGPT_SIGN_IN','ChatGPT 連線已過期，請重新登入。');
    try{
      const response=await this.fetcher(`${ISSUER}/api/accounts/oauth/token`,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'refresh_token',client_id:profile.clientId,refresh_token:profile.refreshToken,resource:RESOURCE}),signal:AbortSignal.timeout(10000),redirect:'error'});
      if(!response.ok)throw new Error('Renew failed');const token=await response.json();
      if(token.id_token){const identity=await this.verify(token.id_token,profile.clientId);if(identity.sub!==profile.subject)throw new Error('Identity mismatch');}
      Object.assign(profile,this.tokenProfile(profile,token));await this.persist();
    }catch{throw new AiError(401,'CHATGPT_SIGN_IN','無法更新 ChatGPT 連線，請重新登入；沒有改用 API Key。');}
  }
  async logout():Promise<{revoked:boolean}>{return this.exclusive(async()=>{
    await this.init();if(this.pending)throw new AiError(409,'LOGIN_PENDING','請先完成或取消登入。');if(this.refresh)await this.refresh.catch(()=>{});
    const profile=this.data.profiles.find(p=>p.id===this.data.activeId);if(!profile)return{revoked:true};let revoked=!profile.refreshToken;
    if(profile.refreshToken){try{
      const meta=await this.discovery();
      for(let attempt=0;attempt<2;attempt++){
        const response=await this.fetcher(meta.revocation_endpoint,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({token:profile.refreshToken,token_type_hint:'refresh_token',client_id:profile.clientId}),signal:AbortSignal.timeout(5000),redirect:'error'});
        revoked=response.status===200;if(revoked||response.status<500)break;await new Promise(resolve=>setTimeout(resolve,200));
      }
    }catch{revoked=false;}}
    delete profile.accessToken;delete profile.refreshToken;delete profile.idToken;delete profile.expiresAt;profile.scopes=[];
    await this.persist();this.login={state:'idle',message:revoked?'已登出並清除本機憑證。':'本機已登出，但無法確認遠端撤銷；請至 ChatGPT 設定中斷開連線。'};return{revoked};
  });}
  dispose(){this.clearAttempt();}
}
