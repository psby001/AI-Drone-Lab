export type MoveAction = 'move_forward' | 'move_backward' | 'move_left' | 'move_right';
export interface GpsHome { latitude: number; longitude: number }
export interface LocalWaypoint { x: number; y: number; z: number }
export interface GpsWaypoint { latitude: number; longitude: number; altitude: number }
export type FlightCommand =
  | { action: 'takeoff'; altitude: number; speed?: number }
  | { action: 'land' }
  | { action: MoveAction | 'ascend' | 'descend'; distance: number; speed?: number }
  | { action: 'turn_left' | 'turn_right'; angle: number; speed?: number }
  | { action: 'hover'; duration: number }
  | { action: 'set_speed'; speed: number; vertical_speed?: number }
  | { action: 'change_altitude'; altitude: number; speed?: number }
  | { action: 'set_heading'; heading: number; direction?: 'shortest' | 'left' | 'right'; speed?: number }
  | ({ action: 'goto_local'; speed?: number } & LocalWaypoint)
  | ({ action: 'goto_gps'; speed?: number } & GpsWaypoint);
export type FollowWaypoints = { action: 'follow_waypoints'; speed?: number } & (
  { frame: 'local'; waypoints: LocalWaypoint[] } | { frame: 'gps'; waypoints: GpsWaypoint[] }
);
export type ReturnToLaunch = { action: 'return_to_launch'; altitude?: number; speed?: number };
export type ParallelAction = Extract<FlightCommand,{distance:number}|{angle:number}|{action:'change_altitude'}|{action:'set_heading'}>;
export interface ParallelCommand { action:'parallel';reference_frame?:'body'|'start';commands:ParallelAction[] }
export type ExecutableCommand = FlightCommand | ParallelCommand | import('../camera/types').CameraCommand;
export type MissionCommand = ExecutableCommand | FollowWaypoints | ReturnToLaunch | { action: 'repeat'; count: number; commands: MissionCommand[] };
export interface Mission { version?: '1.0' | '1.1' | '1.2'; name?: string; home?: GpsHome; commands: MissionCommand[] }
export interface MissionPose { east: number; north: number; up: number; heading: number }
export interface MissionStep {
  command: ExecutableCommand; sourcePath: string; target: MissionPose;
  speeds: { horizontal: number; vertical: number; yaw: number };
  trajectory?:ParallelTrajectory;
  label?: string;
}
export interface ParallelTrajectory { start:MissionPose;frame:'body'|'start';forward:number;right:number;up:number;heading:number;duration:number }
export interface MissionPlan { mission: Mission; origin: MissionPose; steps: MissionStep[]; estimatedSeconds: number;commandCount:number }
export type MissionStatus = 'empty' | 'ready' | 'running' | 'paused' | 'stopped' | 'completed' | 'failed';
export interface MissionSnapshot { status: MissionStatus; index: number; elapsed: number; message: string; completed: number[] }
