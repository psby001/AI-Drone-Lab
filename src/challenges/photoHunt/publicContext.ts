import type { ChallengeDefinition } from '../types';
/** Explicit whitelist: never serialize objectives, candidate spawns or Ground Truth to the planner. */
export function publicHuntContext(d:ChallengeDefinition|null){
  if(d?.metadata.experience!=='photo-hunt')return '';
  const regions=(Array.isArray(d.metadata.public_regions)?d.metadata.public_regions:[]).filter((r):r is {name:string;east:number;north:number}=>!!r&&typeof r.name==='string'&&r.name.length<80&&Number.isFinite(r.east)&&Number.isFinite(r.north)).slice(0,5);
  return `攝影尋寶公開資訊：起點 ENU (${d.spawn.position.east},${d.spawn.position.north},0)，起始航向 ${d.spawn.heading} 度。goto_local 的 x 東、y 北均相對起點，z 為起飛地面相對高度。公開區域中心（不是隱藏目標座標）：${regions.map(r=>`${r.name} goto_local x=${r.east-d.spawn.position.east},y=${r.north-d.spawn.position.north}`).join('；')}。建議停車場／露營區 6m，貨櫃區 9m，Nadir 航向穩定相機拍照。保留三區搜尋次序可避免遺漏；最後 return_to_launch。不得假設已找到目標。`;
}
