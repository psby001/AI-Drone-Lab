import { existsSync,readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createPrivateKey,X509Certificate } from 'node:crypto';
import type { ServerOptions } from 'node:https';
/** Only the Node configuration process reads these buffers; never expose them through Vite env. */
export function loadLocalTls(root:string,mode=process.env.DRONE_HTTPS){
  if(mode==='0')return undefined;
  const certPath=resolve(root,'ssl/server-fullchain.pem'),keyPath=resolve(root,'ssl/server-privatekey.pem');
  if(!existsSync(certPath)&&!existsSync(keyPath)&&mode!=='1')return undefined;
  if(!existsSync(certPath)||!existsSync(keyPath))throw new Error('HTTPS 需要 ssl/server-fullchain.pem 與 ssl/server-privatekey.pem，請完整匯出憑證及私鑰。');
  let cert:Buffer,key:Buffer,leaf:X509Certificate;
  try{cert=readFileSync(certPath);key=readFileSync(keyPath);leaf=new X509Certificate(cert);if(!leaf.checkPrivateKey(createPrivateKey(key)))throw new Error();}catch{throw new Error('HTTPS 憑證或私鑰格式錯誤、私鑰需要密碼，或兩者不相符；請重新確認 Certify 的 PEM 匯出。');}
  if(Date.now()<Date.parse(leaf.validFrom)||Date.now()>=Date.parse(leaf.validTo))throw new Error('HTTPS 憑證尚未生效或已過期，請檢查系統時間與 Certify 匯出檔案。');
  const hosts=(leaf.subjectAltName??'').split(', ').filter(s=>s.startsWith('DNS:')).map(s=>s.slice(4)).filter(s=>/^[a-zA-Z0-9.-]+$/.test(s));
  return{options:{cert,key,minVersion:'TLSv1.2'} satisfies ServerOptions,hosts};
}

export function privateServerPath(url:string){
  try{const path=decodeURIComponent(new URL(url,'http://localhost').pathname).replace(/\\/g,'/');return /(^|\/)(server|ssl)(\/|$)|\.(pem|key|pfx|p12|crt|cer|der)(?:[/?]|$)/i.test(path);}catch{return true;}
}
