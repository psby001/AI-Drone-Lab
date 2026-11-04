import { it } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { Joystick } from '../src/components/Joystick';
import { ManualController } from '../src/input/ManualController';
import { neutralInput } from '../src/core/flight';

it('two independent pointer owners, cancellation, resize, disable and recenter', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost' });
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true });
  const root = createRoot(document.getElementById('root')!);
  const controller = new ManualController();
  const render = async (disabled = false) => act(() => root.render(createElement('div', {},
    createElement(Joystick, { side: 'left', controller, disabled }),
    createElement(Joystick, { side: 'right', controller, disabled }))));
  await render();
  const [left, right] = Array.from(document.querySelectorAll<HTMLElement>('.joystick'));
  const captures = new Map<HTMLElement, Set<number>>();
  for (const pad of [left, right]) {
    captures.set(pad, new Set());
    pad.getBoundingClientRect = () => ({ left: 0, top: 0, width: 140, height: 140, right: 140, bottom: 140, x: 0, y: 0, toJSON() {} });
    pad.setPointerCapture = id => { captures.get(pad)!.add(id); };
    pad.hasPointerCapture = id => captures.get(pad)!.has(id);
    pad.releasePointerCapture = id => { captures.get(pad)!.delete(id); };
  }
  const pointer = async (pad: HTMLElement, type: string, id: number, x: number, y: number) => act(() => {
    const event = new dom.window.Event(type, { bubbles: true, cancelable: true });
    Object.assign(event, { pointerId: id, pointerType: 'touch', clientX: x, clientY: y, button: 0 });
    pad.dispatchEvent(event);
  });
  await pointer(left, 'pointerdown', 11, 70, 25);
  await pointer(right, 'pointerdown', 22, 100, 35);
  assert.equal(controller.sample().vertical, 1);
  assert.ok(controller.sample().forward > 0 && controller.sample().right > 0);
  // A third finger cannot steal an already-owned stick.
  await pointer(left, 'pointerdown', 33, 70, 115);
  await pointer(left, 'pointermove', 33, 70, 115);
  assert.equal(controller.sample().vertical, 1);
  await pointer(left, 'pointerup', 11, 70, 25);
  assert.equal(controller.sample().vertical, 0);
  assert.ok(controller.sample().forward > 0);
  assert.equal(left.querySelector<HTMLElement>('.stick-thumb')!.style.transform, 'translate(0px, 0px)');
  await pointer(right, 'pointercancel', 22, 100, 35);
  assert.deepEqual(controller.sample(), neutralInput());
  await pointer(left, 'pointerdown', 44, 115, 70);
  await pointer(left, 'lostpointercapture', 44, 115, 70);
  assert.deepEqual(controller.sample(), neutralInput());
  await pointer(right, 'pointerdown', 55, 70, 25);
  await act(() => controller.clear());
  await pointer(right, 'pointermove', 55, 100, 25);
  assert.deepEqual(controller.sample(), neutralInput());
  await pointer(left, 'pointerdown', 66, 70, 25);
  await act(() => dom.window.dispatchEvent(new dom.window.Event('resize')));
  assert.deepEqual(controller.sample(), neutralInput());
  await pointer(left, 'pointerdown', 77, 70, 25);
  await render(true);
  assert.deepEqual(controller.sample(), neutralInput());
  await pointer(right, 'pointerdown', 88, 70, 25);
  assert.deepEqual(controller.sample(), neutralInput());
  await act(() => root.unmount()); dom.window.close();
});
