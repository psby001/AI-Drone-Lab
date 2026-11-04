import { AI_LIMITS as A } from '../src/ai/contracts';
import type { ServerConfig } from './config';
interface Bucket { minute:number; hour:number; minuteCount:number; hourCount:number }
export class RequestLimiter {
  private clients=new Map<string,Bucket>();
  private global:Bucket={minute:-1,hour:-1,minuteCount:0,hourCount:0};
  constructor(private config:ServerConfig,private clock=()=>Date.now()){}
  take(ip:string):number {
    const now=this.clock(),minute=Math.floor(now/60000),hour=Math.floor(now/3600000);
    const reset=(bucket:Bucket)=>{
      if(bucket.minute!==minute){bucket.minute=minute;bucket.minuteCount=0;}
      if(bucket.hour!==hour){bucket.hour=hour;bucket.hourCount=0;}
    };
    reset(this.global);
    if(!this.clients.has(ip)){
      for(const [key,bucket] of this.clients)if(bucket.hour!==hour)this.clients.delete(key);
      if(this.clients.size>=A.maxClients)return 60;
      this.clients.set(ip,{minute,hour,minuteCount:0,hourCount:0});
    }
    const client=this.clients.get(ip)!;reset(client);
    if(client.hourCount>=this.config.perIpHour||this.global.hourCount>=this.config.globalHour)return Math.max(1,Math.ceil(((hour+1)*3600000-now)/1000));
    if(client.minuteCount>=this.config.perIpMinute||this.global.minuteCount>=this.config.globalMinute)return Math.max(1,Math.ceil(((minute+1)*60000-now)/1000));
    client.minuteCount++;client.hourCount++;this.global.minuteCount++;this.global.hourCount++;return 0;
  }
}
