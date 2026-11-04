import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { ManualController, stickVector } from '../input/ManualController';
interface Props { side: 'left' | 'right'; controller: ManualController; disabled: boolean }
export function Joystick({ side, controller, disabled }: Props) {
  const owner = useRef<number | null>(null);
  const [thumb, setThumb] = useState({ x: 0, y: 0 });
  const center = () => { owner.current = null; setThumb({ x: 0, y: 0 }); };
  useEffect(() => controller.subscribeClear(center), [controller]);
  useEffect(() => {
    const cancel = () => { controller.releaseStick(side); center(); };
    window.addEventListener('resize', cancel);
    if (disabled) cancel();
    return () => { window.removeEventListener('resize', cancel); controller.releaseStick(side); };
  }, [controller, side, disabled]);
  const move = (event: PointerEvent<HTMLDivElement>) => {
    if (owner.current !== event.pointerId) return;
    const rect = event.currentTarget.getBoundingClientRect(), radius = rect.width * 0.32;
    const x = event.clientX - rect.left - rect.width / 2, y = event.clientY - rect.top - rect.height / 2;
    const factor = Math.min(1, radius / (Math.hypot(x, y) || 1));
    setThumb({ x: x * factor, y: y * factor });
    const input = stickVector(x, y, radius); controller.setStick(side, input.x, input.y);
  };
  const release = (event: PointerEvent<HTMLDivElement>) => {
    if (owner.current !== event.pointerId) return;
    controller.releaseStick(side); center();
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  return <div className={`joystick-group ${side}`}>
    <div className="stick-label">{side === 'left' ? '高度 / 航向' : '前後 / 平移'}<small>{side === 'left' ? 'LEFT STICK' : 'RIGHT STICK'}</small></div>
    <div className={`joystick ${disabled ? 'disabled' : ''}`} role="group"
      aria-label={side === 'left' ? '左搖桿：上下升降，左右轉向' : '右搖桿：上下前後，左右平移'} aria-disabled={disabled}
      onContextMenu={event => event.preventDefault()}
      onPointerDown={event => {
        if (disabled || owner.current !== null || (event.pointerType === 'mouse' && event.button !== 0)) return;
        event.preventDefault(); owner.current = event.pointerId;
        event.currentTarget.setPointerCapture(event.pointerId); move(event);
      }} onPointerMove={move} onPointerUp={release} onPointerCancel={release} onLostPointerCapture={release}>
      <span className="stick-north">{side === 'left' ? '升' : '前'}</span><span className="stick-south">{side === 'left' ? '降' : '後'}</span>
      <span className="stick-west">{side === 'left' ? '↶' : '左'}</span><span className="stick-east">{side === 'left' ? '↷' : '右'}</span>
      <span className="stick-cross"/><span className="stick-thumb" style={{ transform: `translate(${thumb.x}px, ${thumb.y}px)` }}>✣</span>
    </div>
  </div>;
}
