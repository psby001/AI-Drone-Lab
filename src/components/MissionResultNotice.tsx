import { useEffect, useState } from 'react';
import type { MissionStatus } from '../missions/types';
import { MISSION_STATUS } from '../missions/status';

interface Props {
  status: MissionStatus;
  message: string;
  hidden: boolean;
  collision: boolean;
  onAction: () => void;
}

export function MissionResultNotice({status,message,hidden,collision,onAction}:Props) {
  const [dismissed,setDismissed]=useState(false);
  useEffect(()=>{
    setDismissed(false);
    // Keep failure details available until explicitly dismissed or reset.
    if(status==='completed') {
      const timer=setTimeout(()=>setDismissed(true),5000);
      return ()=>clearTimeout(timer);
    }
  },[status,message]);
  if(hidden||dismissed||!['completed','failed','stopped'].includes(status))return null;
  return <div className="mission-result" role="status">
    {MISSION_STATUS[status]}：{message}
    <button onClick={onAction}>{collision?'重置':'查看任務'}</button>
    <button aria-label="關閉任務通知" onClick={()=>setDismissed(true)}>關閉</button>
  </div>;
}
