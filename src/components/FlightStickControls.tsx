import { Joystick } from './Joystick';
import { PAD_STATUS } from './GamepadPicker';
import type { PadSnapshot } from '../input/GamepadController';
import type { FlightMode, ControlMode } from '../core/flight';
import type { ManualController } from '../input/ManualController';

interface Props { snapshot: PadSnapshot; controller: ManualController; disabled: boolean; mode: FlightMode; controlMode?: ControlMode }
export function FlightStickControls({ snapshot, controller, disabled, mode, controlMode = 'position' }: Props) {
  if (snapshot.selected !== null) {
    return <div className="physical-controller-status" role="status">
      <b>🎮 {snapshot.devices.find(device => device.index === snapshot.selected)?.name.split(' — ')[0]}</b>
      <span>{PAD_STATUS[snapshot.status]}</span><small>左桿：升降／轉向 · 右桿：前後／平移</small>
    </div>;
  }
  return <><div className="joystick-deck">
    <Joystick side="left" controller={controller} disabled={disabled}/>
    <div className="stick-center-note">{mode === 'grounded' ? '先按 Arm' : mode === 'armed' ? '推升降桿起飛' : mode === 'flying' ? (controlMode === 'position' ? '放開定位煞停' : '放開回正・仍會漂移') : '自動降落中'}</div>
    <Joystick side="right" controller={controller} disabled={disabled}/>
  </div>{snapshot.status === 'disconnected' && <div className="device-disconnected" role="status">{PAD_STATUS.disconnected}</div>}</>;
}
