import * as THREE from 'three';
import { radians, toScene, type Vec3 } from '../core/coordinates';
import type { FlightState } from '../core/flight';

export type CameraMode = 'follow' | 'fixed';
// ENU metres, anchored to the scene rather than the aircraft or its heading.
export const FIXED_CAMERA_POSITION: Readonly<Vec3> = Object.freeze({ east: 0, north: -10, up: 5 });

export class CameraRig {
  mode: CameraMode = 'follow';
  private look = new THREE.Vector3();
  constructor(private camera: THREE.PerspectiveCamera) {}
  setMode(mode: CameraMode) { this.mode = mode; }
  update(state: Pick<FlightState, 'position' | 'heading'>, delta: number) {
    const dt = Number.isFinite(delta) ? Math.max(0, Math.min(delta, 0.1)) : 0;
    const position = new THREE.Vector3(...toScene(state.position));
    const aim = position.clone().add(new THREE.Vector3(0, 0.5, 0));
    if (this.mode === 'fixed') {
      this.camera.position.set(...toScene(FIXED_CAMERA_POSITION));
      this.look.copy(aim);
    } else {
      const heading = radians(state.heading);
      const target = new THREE.Vector3(position.x - Math.sin(heading) * 8, position.y + 5.5, position.z + Math.cos(heading) * 8);
      this.camera.position.lerp(target, 1 - Math.exp(-3 * dt));
      this.look.lerp(aim, 1 - Math.exp(-5 * dt));
    }
    this.camera.lookAt(this.look);
  }
}
