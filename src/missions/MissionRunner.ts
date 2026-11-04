import { FlightModel, neutralInput, LIMITS, type ControlInput } from '../core/flight';
import { radians, type Vec3 } from '../core/coordinates';
import { MISSION_LIMITS as M } from '../config/limits';
import type { MissionPlan, MissionSnapshot } from './types';
import { validateMission } from './validate';
import { parallelBounds,parallelSample } from './parallel';
import { isCameraCommand,type MissionCameraPort } from '../camera/types';
const clamp = (v: number, max: number) => Math.max(-max, Math.min(max, v));
const angleDelta = (to: number, from: number) => ((to - from + 540) % 360) - 180;

/** Owns command targets and sends ControlInput to the existing physics model.
 * It never writes position/velocity/heading or any Three.js object. */
export class MissionRunner {
  plan: MissionPlan | null = null;
  snapshot: MissionSnapshot = { status: 'empty', index: 0, elapsed: 0, message: '請載入任務', completed: [] };
  private accumulator = 0;
  private commandTime = 0;
  private stableTime = 0;
  private hoverTime = 0;
  private trajectoryTime = 0;
  private landStarted = false;
  private previousHeading = 0;
  private unwrappedHeading = 0;
  private integral = { east: 0, north: 0, up: 0 };
  private cameraPort:MissionCameraPort|null=null;
  private cameraAbort:AbortController|null=null;
  private cameraPending=false;
  private cameraDone=false;
  setCameraPort(port:MissionCameraPort|null){if(this.cameraPort!==port)this.cancelCamera();this.cameraPort=port;}
  private cancelCamera(){this.cameraAbort?.abort();this.cameraAbort=null;this.cameraPort?.cancel();this.cameraPending=false;this.cameraDone=false;}
  constructor(readonly model: FlightModel) {}
  get ownsControl() { return this.snapshot.status === 'running' || this.snapshot.status === 'paused'; }
  load(source: string | unknown): string[] {
    if (this.ownsControl) return ['請先停止任務，再載入新任務。'];
    const result = validateMission(source);
    this.plan = result.plan ?? null;
    this.snapshot = { status: result.plan ? 'ready' : 'failed', index: 0, elapsed: 0, completed: [], message: result.errors.join('\n') || '任務已驗證，可開始' };
    return result.errors;
  }
  start(): boolean {
    if (!this.plan || this.ownsControl) return false;
    const s = this.model.state;
    if (s.mode !== 'grounded' && s.mode !== 'armed') { this.snapshot.message = '開始前請先降落，或重置任務與飛機。'; return false; }
    const validated = validateMission(this.plan.mission, { ...s.position, heading: s.heading });
    if (!validated.plan) { this.snapshot.status = 'failed'; this.snapshot.message = validated.errors.join('\n'); return false; }
    if(validated.plan.steps.some(step=>(step.trajectory?parallelBounds(step.trajectory,validated.plan!.origin):[step.target]).some(p=>!this.model.containsPosition(p)))){this.snapshot.status='failed';this.snapshot.message='任務路徑超出目前場景的飛行邊界或高度限制';return false;}
    this.cancelCamera();this.plan = validated.plan; this.accumulator = 0; this.previousHeading = s.heading; this.unwrappedHeading = s.heading;
    this.model.setControlMode('position'); this.model.arm(); this.resetStep();
    this.snapshot = { status: 'running', index: 0, elapsed: 0, message: '執行中（自動定位控制）', completed: [] };
    return true;
  }
  pause() {
    if (this.snapshot.status !== 'running') return;
    this.model.holdPosition(); this.snapshot.status = 'paused'; this.snapshot.message = '已暫停，定位煞停並保持高度';
    this.stableTime = 0; this.landStarted = false; this.integral = { east: 0, north: 0, up: 0 };
  }
  resume() {
    if (this.snapshot.status !== 'paused') return;
    this.snapshot.status = 'running'; this.snapshot.message = '繼續原指令與原目標';
  }
  stop() {
    if (!this.ownsControl) return;
    this.cancelCamera();this.model.holdPosition(); this.snapshot.status = 'stopped'; this.snapshot.message = '已停止；飛機定位保持，可手動接管或重置';
  }
  reset() {
    this.cancelCamera();
    this.model.reset(); this.accumulator = 0; this.resetStep();
    if(this.plan) this.plan = validateMission(this.plan.mission).plan ?? null;
    this.snapshot = { status: this.plan ? 'ready' : 'empty', index: 0, elapsed: 0, completed: [], message: this.plan ? '已重置任務與飛機，可重新執行' : '請載入任務' };
  }
  fail(message: string) {
    this.cancelCamera();
    this.model.holdPosition(); this.snapshot.status = 'failed'; this.snapshot.message = message;
  }
  update(delta: number) {
    if (!this.ownsControl || !Number.isFinite(delta) || delta <= 0) return;
    this.accumulator += Math.min(delta, 0.1);
    while (this.accumulator >= 1/120 - 1e-10 && this.ownsControl) { this.tick(1/120); this.accumulator -= 1/120; }
  }
  private resetStep() {
    this.cameraPending=false;this.cameraDone=false;this.cameraAbort=null;
    this.commandTime = 0; this.stableTime = 0; this.hoverTime = 0; this.landStarted = false;
    this.trajectoryTime=0;
    this.integral = { east: 0, north: 0, up: 0 };
  }
  private tick(dt: number) {
    if (!this.plan) { this.fail('找不到任務快照'); return; }
    if (this.snapshot.status === 'paused') { this.model.update(dt, neutralInput()); this.trackHeading(); return; }
    this.snapshot.elapsed += dt; this.commandTime += dt;
    if (this.snapshot.elapsed > M.maxDuration || this.commandTime > M.commandTimeout) { this.fail('任務或目前指令執行逾時，已停止並定位保持'); return; }
    const step = this.plan.steps[this.snapshot.index], s = this.model.state;
    if (s.controlMode !== 'position') { this.fail('自動任務需要定位模式'); return; }
    const command = step.command;
    if(isCameraCommand(command)){
      if(!this.cameraPort){this.fail('相機模組不可用，未執行相機指令');return;}
      if(!this.cameraPending){
        this.cameraPending=true;this.model.holdPosition();const abort=new AbortController();this.cameraAbort=abort;
        try{Promise.resolve(this.cameraPort.execute(command,abort.signal)).then(()=>{if(!abort.signal.aborted)this.cameraDone=true;}).catch(error=>{if(!abort.signal.aborted)this.fail(error instanceof Error?error.message:'相機指令失敗');});}
        catch(error){this.fail(error instanceof Error?error.message:'相機指令失敗');return;}
      }
      this.model.update(dt,neutralInput());this.trackHeading();
      if(s.boundary||Math.hypot(s.position.east-this.plan.origin.east,s.position.north-this.plan.origin.north)>LIMITS.radius+0.01||s.position.up>LIMITS.maxAltitude+0.01){this.fail('相機動作期間觸及安全邊界');return;}
      if(this.cameraDone)this.completeStep();return;
    }
    if(command.action==='set_speed'){
      this.completeStep();return;
    }
    let input = neutralInput();
    if (command.action === 'land') {
      if (!this.landStarted) { this.model.land(); this.landStarted = true; }
    } else if (s.mode === 'grounded' || (s.mode === 'armed' && command.action !== 'takeoff')) { this.fail('飛機意外接地或尚未 Arm'); return; }
    else if(step.trajectory){
      const previous=parallelSample(step.trajectory,this.trajectoryTime);
      const advance=Math.hypot(s.position.east-previous.position.east,s.position.north-previous.position.north,s.position.up-previous.position.up)<=M.trajectoryMaxLag&&Math.abs(previous.position.heading-this.unwrappedHeading)<=M.trajectoryMaxHeadingLag;
      if(advance)this.trajectoryTime=Math.min(step.trajectory.duration,this.trajectoryTime+dt);
      const sample=parallelSample(step.trajectory,this.trajectoryTime);
      input=this.navigate(sample.position,dt,advance?sample:{velocity:{east:0,north:0,up:0},yawRate:0});
    }else input = this.navigate(step.target, dt);
    this.model.update(dt, input); this.trackHeading();
    const distanceFromHome = Math.hypot(s.position.east - this.plan.origin.east, s.position.north - this.plan.origin.north);
    if (s.boundary || distanceFromHome > LIMITS.radius + 0.01 || s.position.up > LIMITS.maxAltitude + 0.01) { this.fail('飛行觸及安全邊界，任務已停止'); return; }
    let complete = false;
    if (command.action === 'land') {
      complete = s.position.up === 0 && (s.mode === 'armed' || s.mode === 'grounded');
      if (complete) this.model.disarm();
    } else {
      const stable = (!step.trajectory||this.trajectoryTime>=step.trajectory.duration)&&Math.hypot(s.position.east - step.target.east, s.position.north - step.target.north) <= M.positionTolerance
        && Math.abs(s.position.up - step.target.up) <= M.altitudeTolerance
        && Math.hypot(s.velocity.east, s.velocity.north, s.velocity.up) <= M.velocityTolerance
        && Math.abs(step.target.heading - this.unwrappedHeading) <= M.headingTolerance && Math.abs(s.yawRate) <= M.yawRateTolerance;
      this.stableTime = stable ? this.stableTime + dt : 0;
      if (command.action === 'hover') {
        if (stable) this.hoverTime += dt;
        complete = this.hoverTime >= command.duration && this.stableTime >= M.settleTime;
      } else complete = this.stableTime >= M.settleTime;
    }
    if (complete) {
      this.completeStep();
    }
  }
  private completeStep(){
    this.snapshot.completed.push(this.snapshot.index);
    if(this.snapshot.index+1===this.plan!.steps.length){this.snapshot.status='completed';this.snapshot.message='任務完成，已落地並 Disarm';}
    else{this.snapshot.index++;this.resetStep();}
  }
  private trackHeading() {
    this.unwrappedHeading += angleDelta(this.model.state.heading, this.previousHeading);
    this.previousHeading = this.model.state.heading;
  }
  private navigate(target: Vec3 & { heading: number }, dt: number,feedforward?:{velocity:Vec3;yawRate:number}): ControlInput {
    const s = this.model.state;
    // Boundary goals are tracked just inside the fence, within the declared
    // arrival tolerance, so controller lag cannot force a nominal 20m goal out.
    const goal = { ...target, up: Math.min(target.up, this.model.flightBounds.maxAltitude - M.boundaryInset) };
    const radius = Math.hypot(goal.east, goal.north);
    if(radius>this.model.flightBounds.radius-M.boundaryInset){goal.east*=(this.model.flightBounds.radius-M.boundaryInset)/radius;goal.north*=(this.model.flightBounds.radius-M.boundaryInset)/radius;}
    const speeds=this.plan!.steps[this.snapshot.index].speeds;
    const horizontalLimit = speeds.horizontal;
    const verticalLimit = speeds.vertical;
    const velocity = { east: 0, north: 0, up: 0 };
    for (const axis of ['east', 'north', 'up'] as const) {
      const error = goal[axis] - s.position[axis];
      if(Math.abs(error)<1 && Math.abs(s.velocity[axis])<1) this.integral[axis] = clamp(this.integral[axis] + error * dt * 0.15, 0.8);
      else this.integral[axis] *= Math.exp(-dt);
      const desired=feedforward?.velocity[axis]??0;
      velocity[axis] = desired+error * 0.8 - (s.velocity[axis]-desired) * 0.2 + this.integral[axis];
    }
    const magnitude = Math.hypot(velocity.east, velocity.north), scale = Math.min(1, horizontalLimit / (magnitude || 1));
    velocity.east *= scale; velocity.north *= scale;
    const h = radians(s.heading);
    const yawLimit = speeds.yaw;
    return {
      forward: (velocity.east * Math.sin(h) + velocity.north * Math.cos(h)) / LIMITS.maxSpeed,
      right: (velocity.east * Math.cos(h) - velocity.north * Math.sin(h)) / LIMITS.maxSpeed,
      vertical: clamp(velocity.up, Math.min(verticalLimit, LIMITS.verticalSpeed)) / LIMITS.verticalSpeed,
      yaw: clamp((feedforward?.yawRate??0)+(target.heading - this.unwrappedHeading) * 1.8 - (s.yawRate-(feedforward?.yawRate??0)) * 0.3, yawLimit) / LIMITS.yawSpeed,
    };
  }
}
