import { neutralInput, type ControlInput } from '../core/flight';
import { stickVector } from './ManualController';

export interface PadDevice {
  index: number; id: string; connected: boolean; mapping: string; axes: readonly number[];
}
export interface PadInfo { index: number; id: string; name: string; supported: boolean }
export type PadStatus = 'virtual' | 'waiting' | 'ready' | 'paused' | 'disconnected' | 'unavailable';
export interface PadSnapshot { devices: PadInfo[]; selected: number | null; status: PadStatus }

export function describePad(pad: PadDevice): PadInfo {
  const family = /dualsense|ps5|054c.*(?:0ce6|0df2)/i.test(pad.id) ? 'PS5 DualSense'
    : /xbox|xinput|045e/i.test(pad.id) ? 'Xbox' : '遊戲手把';
  return { index: pad.index, id: pad.id, name: `${family} #${pad.index + 1} — ${pad.id}`, supported: pad.mapping === 'standard' && pad.axes.length >= 4 };
}

/** Standard Gamepad layout shared by browser-mapped Xbox and PS5 controllers.
 * Left X/Y -> yaw/height; right X/Y -> strafe/forward. No button auto-takeoff.
 */
export function mapGamepad(pad: PadDevice): ControlInput {
  if (!pad.connected || !describePad(pad).supported || !pad.axes.slice(0, 4).every(Number.isFinite)) return neutralInput();
  const left = stickVector(pad.axes[0], pad.axes[1], 1);
  const right = stickVector(pad.axes[2], pad.axes[3], 1);
  return { yaw: left.x, vertical: left.y === 0 ? 0 : -left.y, right: right.x, forward: right.y === 0 ? 0 : -right.y };
}

/** Device ownership, disconnect fail-safe and neutral-before-arm gate. */
export class GamepadController {
  snapshot: PadSnapshot = { devices: [], selected: null, status: 'virtual' };
  input = neutralInput();
  private selectedId: string | null = null;
  private armed = false;

  select(index: number | null) {
    this.suspend();
    const device = this.snapshot.devices.find(pad => pad.index === index && pad.supported);
    this.snapshot.selected = device?.index ?? null;
    this.selectedId = device?.id ?? null;
    this.snapshot.status = device ? 'waiting' : 'virtual';
  }
  suspend() { this.armed = false; this.input = neutralInput(); }
  disconnect(index: number) {
    if (this.snapshot.selected !== index) return;
    this.suspend(); this.selectedId = null;
    this.snapshot.selected = null; this.snapshot.status = 'disconnected';
  }
  unavailable() {
    this.suspend(); this.selectedId = null; this.snapshot.selected = null;
    this.snapshot.devices = []; this.snapshot.status = 'unavailable';
  }
  poll(pads: readonly (PadDevice | null)[], enabled: boolean): ControlInput {
    this.snapshot.devices = pads.filter((pad): pad is PadDevice => !!pad?.connected).map(describePad);
    if (this.snapshot.status === 'unavailable') this.snapshot.status = 'virtual';
    const selected = this.snapshot.selected;
    if (selected === null) { this.input = neutralInput(); return this.input; }
    const pad = pads.find(pad => pad?.index === selected && pad.connected);
    if (!pad || pad.id !== this.selectedId || !describePad(pad).supported) {
      this.disconnect(selected); return this.input;
    }
    if (!enabled) { this.suspend(); this.snapshot.status = 'paused'; return this.input; }
    // Invalid readings never arm a controller or preserve stale motion.
    if (!pad.axes.slice(0, 4).every(Number.isFinite)) {
      this.suspend(); this.snapshot.status = 'waiting'; return this.input;
    }
    const mapped = mapGamepad(pad);
    if (!this.armed) {
      this.input = neutralInput();
      if (Object.values(mapped).every(value => Math.abs(value) < 0.0001)) {
        this.armed = true; this.snapshot.status = 'ready';
      } else this.snapshot.status = 'waiting';
      return this.input;
    }
    this.snapshot.status = 'ready'; this.input = mapped;
    return this.input;
  }
}
