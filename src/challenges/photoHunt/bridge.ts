import type { ChallengeManager } from '../ChallengeManager';
import type { CameraSnapshot } from '../../groundTruth/types';
import { evaluatePhoto } from './scoring';
import type { HuntParams,PhotoFeedback } from './rule';
export interface PhotoCaptureToken {attempt:string;running:boolean;elapsed:number;scene_id:string;params:HuntParams|null;time_limit:number}
/** The only GT -> challenge adapter. No coordinates or raw annotations cross this boundary. */
export function huntCaptureToken(manager:ChallengeManager):PhotoCaptureToken {
  const s=manager.snapshot,o=s.definition?.objectives.find(o=>o.type==='photo-hunt');
  return{attempt:manager.attemptToken,running:s.status==='RUNNING',elapsed:s.elapsed,scene_id:s.definition?.id??'',params:o?structuredClone(o.params as unknown as HuntParams):null,time_limit:s.definition?.time_limit??0};
}
export function acceptHuntPhoto(manager:ChallengeManager,snapshot:CameraSnapshot,token:PhotoCaptureToken,onPhoto?:(id:string,image:Blob)=>void){
  if(!token.running||!token.params||snapshot.scene_id!==token.scene_id||token.elapsed>token.time_limit||manager.attemptToken!==token.attempt||!['RUNNING','PAUSED'].includes(manager.snapshot.status))return false;
  const feedback:PhotoFeedback={photo_id:snapshot.photo_id,timestamp:snapshot.timestamp,elapsed:token.elapsed,evaluations:token.params.targets.map(t=>evaluatePhoto(snapshot,t,true))};
  const accepted=manager.queueEvent({type:'camera',id:'photo-hunt-evaluated',data:{feedback:feedback as unknown as Record<string,unknown>}},token.attempt);
  if(accepted)onPhoto?.(snapshot.photo_id,snapshot.image_data);return accepted;
}
