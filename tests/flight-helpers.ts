import { FlightModel, neutralInput, type ControlInput } from '../src/core/flight';
export const advance = (m: FlightModel, seconds: number, input: ControlInput = neutralInput(), fps = 120) => {
  for (let i = 0; i < seconds * fps; i++) m.update(1 / fps, input);
};
/** Test pilot: explicitly arm, climb for 1.5s, release and settle. No auto-takeoff API. */
export function launch(m: FlightModel, fps = 120) {
  m.arm(); advance(m, 1.5, { ...neutralInput(), vertical: 1 }, fps); advance(m, 6.5, neutralInput(), fps);
  return m;
}
