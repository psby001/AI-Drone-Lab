import type { ExecutableCommand, MissionStep } from './types';
export function commandLabel(command: ExecutableCommand):string {
  if(command.action==='set_camera_view')return `相機視角 ${command.view.toUpperCase()}`;
  if(command.action==='set_gimbal_pitch'||command.action==='set_gimbal_yaw')return `雲台 ${command.action==='set_gimbal_pitch'?'Pitch':'Yaw'} ${command.angle}°`;
  const cameraLabels:Record<string,string>={reset_gimbal:'重置雲台',capture_photo:'拍攝照片',start_recording:'開始錄影',stop_recording:'停止錄影'};
  if(cameraLabels[command.action])return cameraLabels[command.action];
  if(command.action==='parallel')return `同時執行（${command.reference_frame==='start'?'起始方向':'機體方向'}）：${command.commands.map(commandLabel).join(' ＋ ')}`;
  if(command.action==='set_speed')return `設定速度 ${command.speed}m/s${command.vertical_speed!==undefined?`・升降 ${command.vertical_speed}m/s`:''}`;
  if(command.action==='change_altitude')return `指定高度 ${command.altitude}m`;
  if(command.action==='set_heading')return `絕對航向 ${command.heading}°（${{shortest:'最短',left:'左轉',right:'右轉'}[command.direction??'shortest']}）`;
  if(command.action==='goto_local')return `本地航點 (${command.x}, ${command.y}, ${command.z})m`;
  if(command.action==='goto_gps')return `GPS (${command.latitude.toFixed(6)}, ${command.longitude.toFixed(6)})・高度 ${command.altitude}m`;
  const labels:Record<string,string>={takeoff:'起飛',land:'降落',move_forward:'前進',move_backward:'後退',move_left:'左移',move_right:'右移',turn_left:'左轉',turn_right:'右轉',ascend:'上升',descend:'下降',hover:'懸停'};
  const display=(value:number)=>Number(value.toFixed(2));
  return `${labels[command.action]??command.action}${'altitude'in command?` ${display(command.altitude)}m`:'distance'in command?` ${display(command.distance)}m`:'angle'in command?` ${display(command.angle)}°`:'duration'in command?` ${display(command.duration)}s`:''}`;
}
export const stepLabel=(step:MissionStep):string=>`${step.label?step.label+'・':''}${commandLabel(step.command)}`;
