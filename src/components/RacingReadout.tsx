import type { ChallengeSnapshot } from '../challenges/types';
import type { RacingParams } from '../challenges/racing';
export function RacingReadout({snapshot:s,waypoints=false}:{snapshot:ChallengeSnapshot;waypoints?:boolean}){
  const objective=s.definition?.objectives.find(o=>o.type==='waypoint-race');if(!objective)return null;
  const m=s.metrics[objective.id]??{},p=objective.params as unknown as RacingParams,completed=Number(m.completed_waypoints??0),penalty=Number(m.deviation_penalty??0),multiplier=Number(m.mode_multiplier??1);
  return <><div className="race-readout" aria-label="競速即時資訊">
    <span>時間 <b>{s.elapsed.toFixed(2)}s</b></span><span>偏離加時 <b>+{penalty.toFixed(2)}s</b></span>
    <span>目前航點 <b>{String(m.current_waypoint??p.waypoints[0].waypoint_id)} · {completed}/{p.waypoints.length}</b></span><span>下一航點 <b>{Number(m.next_distance??0).toFixed(1)}m</b></span>
    <span>飛行模式 <b>{s.flight_mode==='attitude'?'姿態（定高輔助）':'定位'}</b></span><span>控制來源 <b>{s.control_source}</b></span>
    <span>預估成績 <b>{((s.elapsed+penalty)*multiplier).toFixed(2)}s</b></span><span>模式倍率 <b>×{multiplier.toFixed(2)}{!p.mode_bonus.enabled?'（關閉）':m.mode_disqualified?'（失格）':m.mode_qualified?'（符合）':'（待判定）'}</b></span>
  </div>{waypoints&&<><ol className="race-waypoints" aria-label="競速航點順序">{p.waypoints.map((w,i)=><li key={w.waypoint_id} data-state={i<completed?'completed':i===completed?'current':'pending'}>{i<completed?'✓':i===completed?'➜':'○'} {w.waypoint_id} · ENU {w.position.east}, {w.position.north}, {w.position.up}m · 半徑 {w.radius}m</li>)}</ol><section aria-label="計分規則"><h4>計分規則</h4><p>等效時間＝（完成時間＋偏離加時）×模式倍率，越低越好。</p><p>允許偏離 {p.d_allow}m；每秒加時＝{p.k} × 超出距離（m）。{p.mode_bonus.enabled?`全程空中使用姿態（定高輔助）才適用 ×${p.mode_bonus.multiplier}；中途切換即失格。`:'模式加成關閉，倍率 1.0。'}</p></section></>}</>;
}
