import { useMemo } from 'react';
import { validateMission } from '../missions/validate';
import { parallelPreview } from '../missions/parallel';
import { stepLabel } from '../missions/labels';
import type { Mission,MissionPose,MissionSnapshot } from '../missions/types';
export function MissionRoutePreview({mission,origin,snapshot}:{mission:Mission|null;origin:MissionPose;snapshot?:MissionSnapshot}){
  const plan=useMemo(()=>mission?validateMission(mission,origin).plan:null,[mission,origin.east,origin.north,origin.up,origin.heading]);
  if(!plan)return <p className="mission-hint">完成合法積木任務後，即可顯示航點預覽。</p>;
  const points=[plan.origin,...plan.steps.flatMap(s=>s.trajectory?parallelPreview(s.trajectory):[s.target])];
  const extent=Math.max(5,...points.flatMap(p=>[Math.abs(p.east-origin.east),Math.abs(p.north-origin.north)]));
  const project=(p:MissionPose)=>`${120+(p.east-origin.east)/extent*62},${75-(p.north-origin.north)/extent*62}`;
  return <section className="mission-route-preview" aria-label="航點預覽">
    <div className="mission-plan-title"><b>航點預覽 · {plan.steps.length} 步</b><span>估計 {plan.estimatedSeconds.toFixed(0)}s</span></div>
    <svg className="mission-map" viewBox="0 0 240 150" role="img" aria-label="任務 ENU 俯視路徑預覽">
      <path d="M120 5V145M10 75H230" stroke="#c0cdbd"/>
      <polyline points={points.map(project).join(' ')} fill="none" stroke="#437a65" strokeWidth="2"/>
      {points.map((p,i)=>{const [cx,cy]=project(p).split(',');return <circle key={i} cx={cx} cy={cy} r={i===0?4:2} fill={i===0?'#d99b35':'#437a65'}/>;})}
      <text x="125" y="13">N</text><text x="222" y="70">E</text>
    </svg>
    <p className="mission-hint">起飛點為圖面原點，金色為起點；路徑為俯視規劃，實際飛行會受風與慣性影響。</p>
    <ol className="mission-steps">{plan.steps.map((step,i)=><li key={i} className={snapshot?.completed.includes(i)?'done':snapshot?.index===i&&['running','paused'].includes(snapshot.status)?'current':''}>
      <b>{stepLabel(step)}</b><small>{snapshot?.completed.includes(i)?'✓ 完成':snapshot?.index===i&&['running','paused'].includes(snapshot.status)?'目前指令':`E ${step.target.east.toFixed(1)}、N ${step.target.north.toFixed(1)}、高 ${step.target.up.toFixed(1)}m`}</small>
    </li>)}</ol>
  </section>;
}
