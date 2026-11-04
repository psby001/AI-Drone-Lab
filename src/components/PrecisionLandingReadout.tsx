import type { ChallengeSnapshot } from '../challenges/types';
import type { LandingParams,LandingScoreParams } from '../challenges/precisionLanding';
export function PrecisionLandingReadout({snapshot:s,details=false}:{snapshot:ChallengeSnapshot;details?:boolean}){
  const objective=s.definition?.objectives.find(o=>o.type==='precision-landing');if(!objective)return null;
  const p=objective.params as unknown as LandingParams,m=s.metrics[objective.id]??{},distance=Number(m.horizontal_distance??-1),landed=m.landed===true;
  const bands=(s.definition!.scoring.params as unknown as LandingScoreParams).bands;
  return <><div className="race-readout landing-readout" aria-label="精準降落資訊"><span>水平距離 <b>{distance<0?'—':`${distance.toFixed(2)}m`}</b></span><span>起飛資格 <b>{m.takeoff_qualified?'已達標':`至少 ${p.min_takeoff_altitude}m`}</b></span><span>首次落點誤差 <b>{landed?`${Number(m.landing_error).toFixed(3)}m`:'尚未接地'}</b></span><span>控制來源 <b>{s.control_source}</b></span></div>
    {details&&<section aria-label="計分規則"><h4>目標與計分規則</h4><p>目標世界 ENU：({p.target.east}, {p.target.north}, 0)m。須實際起飛至少 {p.min_takeoff_altitude}m，首次落地後低速穩定 {p.settle_seconds} 秒。</p><p>任務 goto_local 相對本關起點：x={p.target.east-s.definition!.spawn.position.east}、y={p.target.north-s.definition!.spawn.position.north}；z 為起飛地面相對高度。</p><ul>{bands.map(b=><li key={b.max_error}>水平落點誤差 ≤{b.max_error}m：{b.score} 分</li>)}<li>超過 {p.max_error}m：挑戰失敗，0 分。</li></ul></section>}
  </>;
}
