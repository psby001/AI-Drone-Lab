import type { FlightState } from '../core/flight';
import type { Vec3 } from '../core/coordinates';
import type { WindPreset } from '../core/environment';

export type ChallengeStatus='IDLE'|'LOADING'|'READY'|'COUNTDOWN'|'RUNNING'|'PAUSED'|'COMPLETED'|'FAILED'|'ABORTED';
export type ControlSource='MANUAL'|'AI_MISSION'|'MIXED';
/** Plugins own and validate params; the manager never switches on a plugin type. */
export interface PluginConfig {type:string;params:Record<string,unknown>}
export interface SceneObject {id:string;kind:'building'|'obstacle'|'platform'|'waypoint'|'zone'|'target';position:Vec3;size:Vec3;color:string;solid:boolean}
export interface ChallengeDefinition {
  id:string;version:string;title:string;description:string;difficulty:'beginner'|'intermediate'|'advanced';thumbnail:string;
  scene:PluginConfig&{seed:number;objects:SceneObject[];environment:{wind:WindPreset;direction:number}};
  spawn:{position:Vec3;heading:number};
  objectives:Array<PluginConfig&{id:string;title:string;order:number}>;
  rules:Array<PluginConfig&{id:string}>;scoring:PluginConfig;
  allowed_control_modes:ControlSource[];time_limit:number;metadata:Record<string,unknown>;
}
export interface ChallengeEvent {type:'collision'|'camera'|'mission';id:string;data?:Record<string,unknown>}
export interface RuleInput {drone:Readonly<FlightState>;previous:Readonly<FlightState>|null;dt:number;simulation_time:number;events:readonly ChallengeEvent[]}
export interface Violation {rule_id:string;code:string;message:string;time:number;penalty:number;fatal:boolean}
export type RuleMetrics=Record<string,number|string|boolean>;
export interface RuleEvaluation {progress:number;complete:boolean;precision?:number;collected?:number;violations?:Omit<Violation,'rule_id'|'time'>[];failed?:string;metrics?:RuleMetrics;completed_at?:number}
export interface RuleInstance {evaluate(input:RuleInput):RuleEvaluation;metrics?():RuleMetrics;dispose?():void}
export interface ObjectiveProgress {id:string;title:string;progress:number;completed:boolean;precision:number;collected:number}
export interface RuleOutput {objectives:ObjectiveProgress[];violations:Violation[];completed:boolean;failed:string|null;metrics:Record<string,RuleMetrics>;completed_at?:number}
export interface ScoreContext {completion_time:number;penalty_time:number;completion_rate:number;precision:number;collected:number;completed:boolean;violations:Violation[];metrics?:Record<string,RuleMetrics>}
export interface ScoreLine {label:string;value:number}
export interface ScoreBreakdown {final_score:number;score_unit:string;score_direction:'higher'|'lower';penalties:ScoreLine[];bonuses:ScoreLine[];lines:ScoreLine[]}
export interface ControlRecord {source:ControlSource;time:number}
export interface ChallengeResult extends ScoreBreakdown {
  challenge_id:string;challenge_version:string;attempt_id:string;status:'COMPLETED'|'FAILED'|'ABORTED';control_source:ControlSource;
  control_history:ControlRecord[];completion_time:number;completed_objectives:string[];violations:Violation[];timestamp:string;
  trajectory_summary:{distance:number;max_altitude:number;samples:number;start:Vec3|null;end:Vec3|null};
  seed:number;reason:string;
  metrics?:Record<string,RuleMetrics>;course_key?:string;is_personal_best?:boolean;previous_best?:number|null;
}
export interface ChallengeSnapshot {status:ChallengeStatus;definition:ChallengeDefinition|null;countdown:number;elapsed:number;objectives:ObjectiveProgress[];violations:Violation[];result:ChallengeResult|null;message:string;storage_error:string;metrics:Record<string,RuleMetrics>;control_source:ControlSource;flight_mode:FlightState['controlMode']}
export interface ChallengeSceneHandle {sample?(current:FlightState,previous:FlightState|null):ChallengeEvent[];update?(snapshot:ChallengeSnapshot):void;dispose():void}
export interface ChallengeSceneProvider {load(definition:ChallengeDefinition,signal:AbortSignal):Promise<ChallengeSceneHandle>}
export interface ResultRepository {save(result:ChallengeResult):void;list(challengeId?:string):ChallengeResult[]}
