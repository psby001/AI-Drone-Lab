import { useEffect, useRef, useState } from 'react';
import { GamepadController, type PadSnapshot } from './GamepadController';

export function useGamepads(enabled: boolean) {
  const controller = useRef(new GamepadController());
  const allowed = useRef(enabled); allowed.current = enabled;
  const [snapshot, setSnapshot] = useState<PadSnapshot>(() => structuredClone(controller.current.snapshot));
  useEffect(() => {
    let frame = 0, previous = '';
    const publish = () => {
      const serialized = JSON.stringify(controller.current.snapshot);
      if (serialized !== previous) { previous = serialized; setSnapshot(structuredClone(controller.current.snapshot)); }
    };
    const poll = () => {
      try {
        if (!window.isSecureContext || typeof navigator.getGamepads !== 'function') controller.current.unavailable();
        else controller.current.poll(Array.from(navigator.getGamepads()), allowed.current && document.hasFocus() && !document.hidden);
      } catch { controller.current.unavailable(); }
      publish(); frame = requestAnimationFrame(poll);
    };
    const suspend = () => { controller.current.suspend(); publish(); };
    const disconnect = (event: GamepadEvent) => { controller.current.disconnect(event.gamepad.index); publish(); };
    window.addEventListener('blur', suspend);
    window.addEventListener('pagehide', suspend);
    document.addEventListener('visibilitychange', suspend);
    window.addEventListener('gamepaddisconnected', disconnect);
    // Polling also discovers devices connected before page load and updates reconnects.
    poll();
    return () => {
      cancelAnimationFrame(frame); controller.current.suspend();
      window.removeEventListener('blur', suspend); window.removeEventListener('pagehide', suspend);
      document.removeEventListener('visibilitychange', suspend); window.removeEventListener('gamepaddisconnected', disconnect);
    };
  }, []);
  const select = (index: number | null) => {
    controller.current.select(index); setSnapshot(structuredClone(controller.current.snapshot));
  };
  return { controller, snapshot, select };
}
