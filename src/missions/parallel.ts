import { bodyToWorld,radians,normalizeHeading } from '../core/coordinates';
import { LIMITS as L,MISSION_LIMITS as M } from '../config/limits';
import type { MissionPose,ParallelCommand,ParallelTrajectory,MissionStep } from './types';
/** Analytic body-relative arc, or a straight translation in the initial heading. */
export function parallelPose(t:ParallelTrajectory,q:number):MissionPose {
  const h0=radians(t.start.heading),delta=radians(t.heading),h=h0+delta*q;
  let movement=bodyToWorld(t.forward*q,t.right*q,t.start.heading);
  if(t.frame==='body'&&Math.abs(delta)>1e-9)movement={
    east:(t.forward*(Math.cos(h0)-Math.cos(h))+t.right*(Math.sin(h)-Math.sin(h0)))/delta,
    north:(t.forward*(Math.sin(h)-Math.sin(h0))+t.right*(Math.cos(h)-Math.cos(h0)))/delta,
  };
  return{east:t.start.east+movement.east,north:t.start.north+movement.north,up:t.start.up+t.up*q,heading:t.start.heading+t.heading*q};
}
export function parallelSample(t:ParallelTrajectory,time:number){
  const u=Math.max(0,Math.min(1,time/t.duration)),q=u*u*(3-2*u),rate=6*u*(1-u)/t.duration;
  const position=parallelPose(t,q),v=bodyToWorld(t.forward*rate,t.right*rate,t.frame==='body'?position.heading:t.start.heading);
  return{position,velocity:{...v,up:t.up*rate},yawRate:t.heading*rate};
}
export function parallelPreview(t:ParallelTrajectory){return Array.from({length:73},(_,i)=>parallelPose(t,i/72));}
/** Exact radial extrema for both flight circles, not only the final endpoint. */
export function parallelBounds(t:ParallelTrajectory,origin:MissionPose){
  const q=[0,1],delta=radians(t.heading);
  if(t.frame==='body'&&Math.abs(delta)>1e-9&&Math.hypot(t.forward,t.right)>0){
    const h=radians(t.start.heading),center={east:t.start.east+(t.forward*Math.cos(h)-t.right*Math.sin(h))/delta,north:t.start.north+(-t.forward*Math.sin(h)-t.right*Math.cos(h))/delta};
    const start=Math.atan2(t.start.east-center.east,t.start.north-center.north),end=start+delta;
    for(const reference of [{east:0,north:0},origin]){
      const angle=Math.atan2(center.east-reference.east,center.north-reference.north);
      for(let k=Math.floor((Math.min(start,end)-angle)/Math.PI)-1;k<=Math.ceil((Math.max(start,end)-angle)/Math.PI)+1;k++){
        const value=(angle+k*Math.PI-start)/delta;if(value>0&&value<1)q.push(value);
      }
    }
  }
  return q.map(value=>parallelPose(t,value));
}
export function compileParallel(command:ParallelCommand,start:MissionPose,defaults:MissionStep['speeds']){
  const used=new Set<string>();let forward=0,right=0,up=0,heading=0,forwardSpeed=defaults.horizontal,rightSpeed=defaults.horizontal,vertical=defaults.vertical,yaw=defaults.yaw;
  const horizontalSpeeds:number[]=[];
  for(const child of command.commands){
    const axis=child.action==='move_forward'||child.action==='move_backward'?'forward':child.action==='move_left'||child.action==='move_right'?'right':['ascend','descend','change_altitude'].includes(child.action)?'up':'yaw';
    if(used.has(axis))throw new Error(`parallel 的 ${axis} 控制軸重複，不能同時執行 ${child.action} 與另一個同軸指令。`);used.add(axis);
    if(axis==='forward'||axis==='right'){
      const distance=('distance'in child?child.distance:0)*(['move_backward','move_left'].includes(child.action)?-1:1),speed=child.speed??defaults.horizontal;
      horizontalSpeeds.push(speed);if(axis==='forward'){forward=distance;forwardSpeed=speed;}else{right=distance;rightSpeed=speed;}
    }else if(axis==='up'){
      up=child.action==='change_altitude'?child.altitude-start.up:('distance'in child?child.distance:0)*(child.action==='descend'?-1:1);vertical=child.speed??defaults.vertical;
    }else{
      if(child.action==='set_heading'){
        const current=normalizeHeading(start.heading);heading=((child.heading-current+540)%360)-180;if(heading===-180)heading=180;
        if(child.direction==='right')heading=(child.heading-current+360)%360;if(child.direction==='left')heading=-((current-child.heading+360)%360);
      }else heading=('angle'in child?child.angle:0)*(child.action==='turn_left'?-1:1);
      yaw=child.speed??defaults.yaw;
    }
  }
  const horizontal=Math.min(L.maxSpeed,horizontalSpeeds.length?Math.max(...horizontalSpeeds):defaults.horizontal);
  const duration=Math.max(M.parallelMinDuration,1.5*Math.max(Math.abs(forward)/forwardSpeed,Math.abs(right)/rightSpeed,Math.hypot(forward,right)/horizontal,Math.abs(up)/vertical,Math.abs(heading)/yaw));
  const trajectory:ParallelTrajectory={start:{...start},frame:command.reference_frame??'body',forward,right,up,heading,duration};
  return{trajectory,speeds:{horizontal,vertical,yaw},target:parallelPose(trajectory,1)};
}
