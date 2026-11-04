import type { ChallengeDefinition,ChallengeResult,ResultRepository } from './types';
import { challengeSettingsKey } from './identity';
/** Equal scores use elapsed time as a stable secondary ranking key. */
export function betterResult(candidate:Pick<ChallengeResult,'final_score'|'score_direction'|'completion_time'>,previous:Pick<ChallengeResult,'final_score'|'completion_time'>){return candidate.final_score===previous.final_score?candidate.completion_time<previous.completion_time:candidate.score_direction==='lower'?candidate.final_score<previous.final_score:candidate.final_score>previous.final_score;}
/** Same comparison scope as settlement: current level/settings, successful, by source. */
export function personalBests(records:ChallengeResult[],definition:ChallengeDefinition){
  const key=challengeSettingsKey(definition),best=new Map<string,ChallengeResult>();
  for(const r of records){if(r.status!=='COMPLETED'||r.challenge_id!==definition.id||r.challenge_version!==definition.version||r.course_key!==key)continue;
    const category=JSON.stringify([r.control_source,r.score_unit,r.score_direction]),old=best.get(category);
    if(!old||betterResult(r,old))best.set(category,r);
  }return [...best.values()];
}
export class MemoryResultRepository implements ResultRepository {
  protected results:ChallengeResult[]=[];
  save(result:ChallengeResult){
    const candidates=[structuredClone(result),...this.results.filter(r=>r.attempt_id!==result.attempt_id)],best=new Map<string,ChallengeResult>();
    for(const r of candidates){if(r.status!=='COMPLETED')continue;const key=JSON.stringify([r.challenge_id,r.challenge_version,r.course_key,r.control_source,r.score_unit,r.score_direction]),current=best.get(key);if(!current||betterResult(r,current))best.set(key,r);}
    // Retain each group's best before filling the bounded recent history.
    const ids=new Set([...best.values()].slice(0,100).map(r=>r.attempt_id));for(const r of candidates){if(ids.size>=100)break;ids.add(r.attempt_id);}this.results=candidates.filter(r=>ids.has(r.attempt_id));
  }
  list(id?:string){return structuredClone(this.results.filter(r=>!id||r.challenge_id===id));}
}
/** Inject Storage for tests; storage/quota failures are surfaced by the manager. */
export class LocalResultRepository extends MemoryResultRepository {
  private key='ai-drone-lab.challenge-results.v1';
  constructor(private storage:Storage){super();const raw=storage.getItem(this.key);if(raw){try{const value:unknown=JSON.parse(raw);if(!Array.isArray(value)||value.some(r=>!r||typeof r!=='object'||typeof r.attempt_id!=='string'||typeof r.challenge_id!=='string'||!Number.isFinite(r.final_score)))throw new Error();this.results=value.slice(0,100);}catch{throw new Error('本機成績格式損壞，已改用記憶體儲存');}}}
  override save(result:ChallengeResult){super.save(result);this.storage.setItem(this.key,JSON.stringify(this.results));}
}
