import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
export interface ChatGptProfile {
  id:string;clientId:string;subject?:string;label:string;
  accessToken?:string;refreshToken?:string;idToken?:string;expiresAt?:number;scopes:string[];
}
export interface ChatGptData { version:1;hostId:string;activeId:string|null;profiles:ChatGptProfile[] }
export interface CredentialStore { load():Promise<ChatGptData|null>;save(data:ChatGptData):Promise<void> }
// No credential is passed in a command argument, URL, environment variable or log.
function dpapi(data:Buffer,decrypt:boolean):Promise<Buffer>{
  const operation=decrypt?'Unprotect':'Protect';
  const script=`$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.Security; $b=[Convert]::FromBase64String([Console]::In.ReadToEnd()); $r=[Security.Cryptography.ProtectedData]::${operation}($b,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Out.Write([Convert]::ToBase64String($r))`;
  return new Promise((resolve,reject)=>{
    const child=spawn('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{windowsHide:true,stdio:['pipe','pipe','pipe']});
    let output='';const timer=setTimeout(()=>{child.kill();reject(new Error('Local credential encryption timed out'));},10000);
    child.stdout.on('data',chunk=>{output+=chunk.toString();if(output.length>2000000)child.kill();});
    child.stderr.resume();child.on('error',()=>{clearTimeout(timer);reject(new Error('Local credential encryption unavailable'));});
    child.on('exit',code=>{clearTimeout(timer);if(code!==0)reject(new Error('Local credential encryption failed'));else resolve(Buffer.from(output.trim(),'base64'));});
    child.stdin.on('error',()=>{});child.stdin.end(data.toString('base64'));
  });
}
export class LocalCredentialStore implements CredentialStore {
  constructor(private directory:string){}
  async load():Promise<ChatGptData|null>{
    let bytes:Buffer;try{bytes=await readFile(join(this.directory,'credentials.dat'));}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return null;throw error;}
    if(bytes.length>1000000)throw new Error('Invalid local credential file');
    if(process.platform==='win32')bytes=await dpapi(bytes,true);
    const data=JSON.parse(bytes.toString('utf8')) as ChatGptData;
    if(data.version!==1||!/^urn:uuid:[a-f0-9-]{36}$/i.test(data.hostId)||!Array.isArray(data.profiles)||data.profiles.length>20||data.profiles.some(p=>!p.id||!p.clientId||!Array.isArray(p.scopes)))throw new Error('Invalid local credential file');
    return data;
  }
  async save(data:ChatGptData){
    await mkdir(this.directory,{recursive:true,mode:0o700});
    let bytes:Buffer=Buffer.from(JSON.stringify(data));if(process.platform==='win32')bytes=await dpapi(bytes,false);
    const temporary=join(this.directory,'credentials.tmp');
    await writeFile(temporary,bytes,{mode:0o600});await rename(temporary,join(this.directory,'credentials.dat'));
  }
}
