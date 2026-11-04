import { it } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { useGamepads } from '../src/input/useGamepads';
import { GamepadPicker,GamepadStatusBadge } from '../src/components/GamepadPicker';
import { FlightStickControls } from '../src/components/FlightStickControls';
import { ManualController } from '../src/input/ManualController';
import type { GamepadController, PadDevice } from '../src/input/GamepadController';
import { neutralInput } from '../src/core/flight';

it('enumerates two devices, hides virtual sticks when selected, restores them on disconnect/API failure', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost', pretendToBeVisual: true });
  let frames = new Map<number, FrameRequestCallback>(), frameId = 0;
  const request = (callback: FrameRequestCallback) => { frames.set(++frameId, callback); return frameId; };
  const cancel = (id: number) => { frames.delete(id); };
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, requestAnimationFrame: request, cancelAnimationFrame: cancel, IS_REACT_ACT_ENVIRONMENT: true });
  Object.defineProperty(dom.window, 'isSecureContext', { value: true });
  document.hasFocus = () => true;
  let devices: (PadDevice | null)[] = [
    { index: 0, id: 'Xbox Wireless Controller', connected: true, mapping: 'standard', axes: [0,0,0,0] },
    null,
    { index: 2, id: 'PS5 DualSense', connected: true, mapping: 'standard', axes: [0,0,0,0] },
  ];
  let denied = false;
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { getGamepads: () => { if (denied) throw new Error('API denied'); return devices; } } });
  let manager: GamepadController | undefined;
  const manual = new ManualController();
  function Harness() {
    const gamepads = useGamepads(true); manager = gamepads.controller.current;
    return createElement('div', {},
      createElement('button',{},'控制裝置',createElement(GamepadStatusBadge,{status:gamepads.snapshot.status})),
      createElement(GamepadPicker, { snapshot: gamepads.snapshot, onSelect: gamepads.select, onClose() {} }),
      createElement(FlightStickControls, { snapshot: gamepads.snapshot, controller: manual, disabled: false, mode: 'flying' }));
  }
  const root = createRoot(document.getElementById('root')!);
  await act(() => root.render(createElement(Harness)));
  const advance = async () => act(() => {
    const queue = frames; frames = new Map(); queue.forEach(callback => callback(0));
  });
  const select = async (value: string) => act(() => {
    const input = document.querySelector('select')!; input.value = value;
    input.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  });
  assert.equal(document.querySelectorAll('option').length, 3);
  assert.match(document.body.textContent!, /Xbox/); assert.match(document.body.textContent!, /PS5/);
  assert.equal(document.querySelectorAll('.joystick').length, 2);
  await select('2'); assert.equal(document.querySelectorAll('.joystick').length, 0);
  assert.match(document.querySelector('.physical-controller-status')!.textContent!, /PS5/);
  assert.equal(document.querySelector('.gamepad-status-badge')!.textContent,'請回中');
  await select('virtual'); assert.equal(document.querySelectorAll('.joystick').length, 2);
  await select('2'); assert.equal(document.querySelectorAll('.joystick').length, 0);
  await advance();
  assert.equal(document.querySelector('.gamepad-status-badge')!.textContent,'已啟用');
  devices[2] = { ...devices[2]!, axes: [0,-1,0,-1] }; await advance();
  assert.equal(manager!.input.vertical, 1); assert.equal(manager!.input.forward, 1);
  await act(() => dom.window.dispatchEvent(new dom.window.Event('blur')));
  assert.deepEqual(manager!.input, neutralInput());
  await advance(); assert.equal(manager!.snapshot.status, 'waiting');
  devices[2] = null; await advance();
  assert.equal(document.querySelectorAll('.joystick').length, 2);
  assert.match(document.body.textContent!, /已斷線/);
  assert.equal(document.querySelector('.gamepad-status-badge')!.textContent,'已斷線');
  await select('0'); await advance(); assert.equal(document.querySelectorAll('.joystick').length, 0);
  // Event, even before the poll array changes, revokes ownership.
  await act(() => {
    const event = new dom.window.Event('gamepaddisconnected'); Object.assign(event, { gamepad: { index: 0 } }); dom.window.dispatchEvent(event);
  });
  assert.equal(document.querySelectorAll('.joystick').length, 2);
  await advance(); assert.equal(manager!.snapshot.selected, null);
  await select('0'); await advance(); denied = true; await advance();
  assert.equal(document.querySelectorAll('.joystick').length, 2); assert.match(document.body.textContent!, /無法讀取手把/);
  assert.equal(document.querySelector('.gamepad-status-badge')!.textContent,'不可用');
  denied = false; await advance(); assert.equal(manager!.snapshot.status, 'virtual');
  await act(() => root.unmount()); assert.equal(frames.size, 0); dom.window.close();
});
