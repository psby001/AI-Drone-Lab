import { OverheadPreview } from './OverheadPreview';
import { FreeSceneManager,type FreeSceneDefinition } from '../scenes/FreeFlightScenes';
import { createFreeSceneCatalog } from '../scenes/catalog';
import * as THREE from 'three';
import { radians, toScene } from '../core/coordinates';
import { LIMITS, type FlightState } from '../core/flight';
import { CameraRig, type CameraMode } from './CameraRig';
import { CameraController } from '../camera/CameraController';
import { DroneCamera } from '../camera/DroneCamera';
import { ThreeChallengeSceneProvider,type SceneFactory } from '../challenges/scene';
import type { PluginRegistry } from '../challenges/registry';
import { disposeSceneGroup } from '../challenges/scene';
import { TargetRegistry } from '../groundTruth/TargetRegistry';
import { GroundTruthService } from '../groundTruth/GroundTruthService';
import type { PreparedSnapshot } from '../groundTruth/types';
import { DEFAULT_TARGET_CLASSES,createGroundTruthTestScene } from '../groundTruth/testScene';
import { DEBUG_LAYER,GroundTruthDebugView } from '../groundTruth/DebugView';
import type { CameraSnapshot } from '../groundTruth/types';
interface InternalPhotoConsumer {prepare:()=>unknown;captured:(snapshot:CameraSnapshot,token:unknown)=>void}

// Scene units are metres. Wheelbase is the diagonal motor-centre distance.
const MOTOR_OFFSET = 0.64;
const WHEELBASE = 0.9;
const DRONE_SCALE = WHEELBASE / (2 * Math.SQRT2 * MOTOR_OFFSET);

export class DroneScene {
  readonly freeScenes:FreeSceneManager;
  private freeRoot=new THREE.Group();
  private activeFreeRoot:THREE.Group|null=null;
  private challengeVisible=false;
  private restoreFreeTruth(){this.internalGroundTruth.activateScene(this.freeScenes?.getActiveScene()?.id??'free-flight',this.activeFreeRoot??this.baseEnvironment);}
  private photoConsumers=new Set<InternalPhotoConsumer>();
  /** Internal sensor hook: capture-time tokens stay paired through asynchronous PNG encoding. */
  subscribeAnnotatedPhotos(consumer:InternalPhotoConsumer){this.photoConsumers.add(consumer);return()=>{this.photoConsumers.delete(consumer);};}
  readonly payloadCamera:DroneCamera;
  readonly overheadPreview:OverheadPreview;
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private baseEnvironment=new THREE.Group();
  private targetRegistry=new TargetRegistry();
  readonly internalGroundTruth=new GroundTruthService(this.targetRegistry,this.scene);
  private debugView:GroundTruthDebugView;
  private testSceneCleanup:(()=>void)|null=null;
  private elapsed=0;
  private sceneGeneration=0;
  private challengeProvider:ThreeChallengeSceneProvider|null=null;
  private camera = new THREE.PerspectiveCamera(48, 1, 0.1, 180);
  private cameraRig = new CameraRig(this.camera);
  private drone = new THREE.Group();
  private airframe = new THREE.Group();
  private windLines: THREE.LineSegments;
  private windOffset = new THREE.Vector3();
  private rotors: THREE.Mesh[] = [];
  private observer: ResizeObserver;
  private shadow: THREE.Mesh;
  constructor(private host: HTMLElement, private tick: (dt: number) => FlightState, private onError: (message: string) => void,cameraController=new CameraController(),private simulationClock?:()=>number,freeHooks?:{before:()=>void;initialize:(d:FreeSceneDefinition)=>void}) {
    for(const category of [...DEFAULT_TARGET_CLASSES,{class_id:5,class_name:'tree'}])this.targetRegistry.registerClass(category);
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1;
    host.appendChild(this.renderer.domElement);
    this.renderer.domElement.setAttribute('aria-label', '無人機第三人稱 3D 飛行場景');
    this.renderer.domElement.addEventListener('webglcontextlost', this.contextLost);
    this.scene.background = new THREE.Color('#bdd5de');
    this.scene.fog = new THREE.Fog('#bdd5de', 48, 115);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x71857a, 2.5));
    const sun = new THREE.DirectionalLight(0xffefcc, 3); sun.position.set(-10, 25, 10); this.scene.add(sun);
    const mesh = (geometry: THREE.BufferGeometry, color: number, x: number, y: number, z: number, parent: THREE.Object3D = this.scene) => {
      const object = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color, roughness: 0.85, flatShading: true }));
      object.position.set(x, y, z); parent.add(object); return object;
    };
    mesh(new THREE.BoxGeometry(220, 0.2, 220), 0x92aaa0, 0, -0.15, 0);
    mesh(new THREE.BoxGeometry(LIMITS.radius*2+2, 0.1, LIMITS.radius*2+2), 0xd4d8c7, 0, -0.04, 0);
    const grid = new THREE.GridHelper(LIMITS.radius*2, 50, 0x9baea7, 0xb4c1b6); grid.position.y = 0.025; this.scene.add(grid);
    const padRadius = 1, padScale = padRadius / 2.1; // 2 m diameter.
    mesh(new THREE.CylinderGeometry(padRadius, padRadius, 0.08, 48), 0x263e44, 0, 0.04, 0);
    const ring = mesh(new THREE.TorusGeometry(1.65*padScale, 0.045*padScale, 8, 48), 0xe9c66b, 0, 0.09, 0); ring.rotation.x = -Math.PI / 2;
    mesh(new THREE.BoxGeometry(0.12*padScale, 0.02, 1.3*padScale), 0xffffff, -0.4*padScale, 0.09, 0);
    mesh(new THREE.BoxGeometry(0.12*padScale, 0.02, 1.3*padScale), 0xffffff, 0.4*padScale, 0.09, 0);
    mesh(new THREE.BoxGeometry(0.8*padScale, 0.02, 0.12*padScale), 0xffffff, 0, 0.09, 0);
    const fenceMaterial = new THREE.LineBasicMaterial({ color: 0xd4a84a, transparent: true, opacity: 0.7 });
    const box = new THREE.CylinderGeometry(LIMITS.radius, LIMITS.radius, LIMITS.maxAltitude, 64, 1, true);
    const fence = new THREE.LineSegments(new THREE.EdgesGeometry(box), fenceMaterial); box.dispose(); fence.position.y = LIMITS.maxAltitude / 2; this.scene.add(fence);
    const wall = new THREE.Mesh(new THREE.CylinderGeometry(LIMITS.radius, LIMITS.radius, LIMITS.maxAltitude, 64, 1, true), new THREE.MeshBasicMaterial({ color: 0xe8c66d, transparent: true, opacity: 0.025, side: THREE.DoubleSide, depthWrite: false })); wall.position.y = LIMITS.maxAltitude / 2; this.scene.add(wall);
    this.scene.add(new THREE.ArrowHelper(new THREE.Vector3(0,0,-1), new THREE.Vector3(-17,0.12,17), 4, 0x267b92, 0.7, 0.4));
    this.scene.add(new THREE.ArrowHelper(new THREE.Vector3(1,0,0), new THREE.Vector3(-17,0.12,17), 4, 0xc57547, 0.7, 0.4));
    // Decorative low-poly trees and hills are outside the flight volume.
    for (let i = 0; i < 22; i++) {
      const angle = i * 2.399, radius = LIMITS.radius + 12 + (i % 4) * 3;
      const x = Math.cos(angle) * radius, z = Math.sin(angle) * radius;
      mesh(new THREE.CylinderGeometry(0.15, 0.23, 1.7, 5), 0x7f8064, x, 0.8, z);
      mesh(new THREE.ConeGeometry(1.5 + i % 2 * 0.4, 3.7, 5), i % 2 ? 0x557c70 : 0x6c9079, x, 3, z);
    }
    for (let i=0;i<8;i++) mesh(new THREE.ConeGeometry(10+i%3*3, 9+i%2*5, 5), 0x8ca79c, Math.cos(i)*100, 3, Math.sin(i)*100);
    // Keep lights shared; all baseline terrain can be hidden without rebuilding the aircraft.
    for(const object of [...this.scene.children])if(!(object instanceof THREE.Light))this.baseEnvironment.add(object);
    this.scene.add(this.baseEnvironment);
    mesh(new THREE.BoxGeometry(0.72, 0.23, 0.92), 0xe8ede6, 0, 0.38, 0, this.drone);
    mesh(new THREE.BoxGeometry(0.45, 0.16, 0.15), 0xf6b64c, 0, 0.4, -0.51, this.drone);
    mesh(new THREE.BoxGeometry(0.28, 0.12, 0.1), 0x233744, 0, 0.31, -0.57, this.drone);
    for (const x of [-MOTOR_OFFSET,MOTOR_OFFSET]) for (const z of [-MOTOR_OFFSET,MOTOR_OFFSET]) {
      const arm = mesh(new THREE.BoxGeometry(0.12, 0.1, 0.94), 0x344b55, x/2, 0.33, z/2, this.drone); arm.rotation.y = x*z>0 ? Math.PI/4 : -Math.PI/4;
      mesh(new THREE.CylinderGeometry(0.14,0.14,0.18,10), z<0 ? 0xefb34f : 0x3a6066, x, 0.4, z, this.drone);
      const rotor = mesh(new THREE.BoxGeometry(0.72,0.025,0.08), 0x29444b, x, 0.51, z, this.drone); this.rotors.push(rotor);
      mesh(new THREE.BoxGeometry(0.05,0.25,0.05), 0x344b55, x*0.6, 0.15, z*0.6, this.drone);
    }
    // Pivot tilt around the body centre, independently of yaw and camera.
    for (const part of [...this.drone.children]) { part.position.y -= 0.33; this.airframe.add(part); }
    this.airframe.position.y = 0.33; this.drone.add(this.airframe);
    this.drone.scale.setScalar(DRONE_SCALE);
    this.scene.add(this.drone);
    this.camera.layers.enable(1);
    this.overheadPreview=new OverheadPreview(this.renderer,this.scene);
    this.payloadCamera=new DroneCamera(cameraController,this.renderer,this.scene,this.airframe);
    this.internalGroundTruth.activateScene('free-flight',this.baseEnvironment);
    this.payloadCamera.setPhotoObserver({prepare:(id,state)=>({snapshot:this.internalGroundTruth.preparePhoto(id,state),consumers:[...this.photoConsumers].map(consumer=>({consumer,token:consumer.prepare()}))}),commit:(_id,prepared,image)=>{const p=prepared as {snapshot:PreparedSnapshot;consumers:Array<{consumer:InternalPhotoConsumer;token:unknown}>};this.internalGroundTruth.commitPhoto(p.snapshot,image);const snapshot={...p.snapshot,image_data:image};for(const entry of p.consumers){if(this.photoConsumers.has(entry.consumer))try{entry.consumer.captured(structuredClone(snapshot),entry.token);}catch{/* Sensor consumers cannot break photos or flight. */}}},remove:id=>this.internalGroundTruth.removePhoto(id)});
    this.debugView=new GroundTruthDebugView(this.scene,this.targetRegistry,this.payloadCamera.camera);this.camera.layers.enable(DEBUG_LAYER);
    const windGeometry = new THREE.BufferGeometry();
    windGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(24 * 6), 3));
    this.windLines = new THREE.LineSegments(windGeometry, new THREE.LineBasicMaterial({ color: 0xe7f7ff, transparent: true, opacity: 0.65, depthWrite: false }));
    this.windLines.frustumCulled = false; this.scene.add(this.windLines);
    this.shadow = new THREE.Mesh(new THREE.CircleGeometry(0.9*DRONE_SCALE,24), new THREE.MeshBasicMaterial({color:0x243c38,transparent:true,opacity:0.18,depthWrite:false})); this.shadow.rotation.x=-Math.PI/2; this.shadow.position.y=0.105; this.scene.add(this.shadow);
    this.camera.position.set(7,6,10);
    this.freeRoot.add(this.baseEnvironment);this.scene.add(this.freeRoot);
    const catalog=createFreeSceneCatalog();
    const provider=new ThreeChallengeSceneProvider(this.scene,this.baseEnvironment,catalog.factories,{loaded:(d,group)=>{this.activeFreeRoot=group;const cleanup=this.internalGroundTruth.activateScene(d.id,group);return()=>{cleanup();if(this.activeFreeRoot===group)this.activeFreeRoot=null;};}},this.freeRoot);
    this.freeScenes=new FreeSceneManager(catalog,provider,{before:()=>{if(this.challengeVisible)throw new Error('請先離開挑戰關卡');this.clearGroundTruthTestScene();freeHooks?.before();},initialize:d=>{this.cameraRig.reset(d.initial_camera_pose);freeHooks?.initialize(d);}});

    this.observer = new ResizeObserver(() => { const w=host.clientWidth,h=host.clientHeight; this.renderer.setSize(w,h); this.camera.aspect=w/Math.max(h,1); this.camera.updateProjectionMatrix(); }); this.observer.observe(host);
    let previous = 0;
    this.renderer.setAnimationLoop((time) => {
      const dt = previous ? Math.min((time-previous)/1000,0.1) : 0; previous=time;
      const state = this.tick(dt), p = new THREE.Vector3(...toScene(state.position));
      this.drone.position.copy(p).y += 0.1; this.drone.rotation.y=-radians(state.heading);
      this.airframe.rotation.set(-radians(state.attitude.pitch), 0, -radians(state.attitude.roll), 'XYZ');
      const wind = new THREE.Vector3(...toScene(state.wind));
      this.windOffset.addScaledVector(wind, dt);
      this.windLines.visible = wind.length() > 0.15;
      const streak = wind.clone().multiplyScalar(0.3);
      const vertices = this.windLines.geometry.getAttribute('position') as THREE.BufferAttribute;
      const wrap = (v: number, size: number) => ((v % size) + size) % size;
      for (let i = 0; i < 24; i++) {
        const x = wrap(i * 17.31 + this.windOffset.x, 40) - 20;
        const y = wrap(i * 3.73 + this.windOffset.y, 10) + 0.5;
        const z = wrap(i * 11.71 + this.windOffset.z, 40) - 20;
        vertices.setXYZ(i * 2, x, y, z); vertices.setXYZ(i * 2 + 1, x - streak.x, y - streak.y, z - streak.z);
      }
      vertices.needsUpdate = true;
      if(state.mode!=='grounded') this.rotors.forEach((r,i)=>r.rotation.y+=dt*(state.mode==='armed'?14:48)*(i%2?1:-1));
      this.shadow.position.set(p.x,0.105,p.z); this.shadow.scale.setScalar(1+state.position.up*0.08);
      this.cameraRig.update(state, dt);
      this.elapsed+=dt;
      this.payloadCamera.update({position:{...state.position},heading:state.heading,attitude:{pitch:state.attitude.pitch,roll:state.attitude.roll}},time,this.simulationClock?.()??this.elapsed);
      this.debugView.update();
      this.overheadPreview.update(p,time);
      this.renderer.render(this.scene,this.camera);
    });
  }
  setCameraMode(mode: CameraMode) { this.cameraRig.setMode(mode); }
  createChallengeSceneProvider(factories:PluginRegistry<SceneFactory>){this.challengeProvider?.dispose();this.challengeProvider=new ThreeChallengeSceneProvider(this.scene,this.freeRoot,factories,{loaded:(d,group)=>{this.challengeVisible=true;const remove=this.internalGroundTruth.activateScene(d.id,group);return()=>{remove();this.challengeVisible=false;this.restoreFreeTruth();};}});return{load:async(d:import('../challenges/types').ChallengeDefinition,signal:AbortSignal)=>{const generation=++this.sceneGeneration;this.clearGroundTruthTestScene();this.challengeVisible=true;try{return await this.challengeProvider!.load(d,signal);}catch(error){if(generation===this.sceneGeneration){this.challengeVisible=false;this.restoreFreeTruth();}throw error;}}};}
  setGroundTruthDebug(enabled:boolean){this.debugView.setEnabled(enabled);}
  async captureAnnotatedPhoto(){const id=await this.payloadCamera.capturePhoto();const snapshot=this.internalGroundTruth.getPhotoSnapshot(id);if(!snapshot)throw new Error('照片已保留，但未產生標註');this.debugView.setAnnotations(snapshot.object_annotations);return snapshot;}
  loadGroundTruthTestScene(){
    this.sceneGeneration++;if(this.challengeVisible)throw new Error('請先離開關卡');this.clearGroundTruthTestScene();
    const group=createGroundTruthTestScene(),background=this.scene.background,fog=this.scene.fog;this.scene.add(group);this.freeRoot.visible=false;this.scene.background=new THREE.Color('#c1d4df');this.scene.fog=new THREE.Fog('#c1d4df',48,115);
    const remove=this.internalGroundTruth.activateScene('ground-truth-test',group);this.testSceneCleanup=()=>{remove();disposeSceneGroup(group);this.freeRoot.visible=true;this.scene.background=background;this.scene.fog=fog;this.restoreFreeTruth();};
  }
  clearGroundTruthTestScene(){this.testSceneCleanup?.();this.testSceneCleanup=null;}
  private contextLost = (event: Event) => { event.preventDefault(); this.renderer.setAnimationLoop(null);void this.payloadCamera.stopRecording().catch(()=>{}); this.onError('3D 繪圖連線中斷，請重新載入頁面。'); };
  dispose() {
    this.clearGroundTruthTestScene();this.debugView.dispose();
    this.challengeProvider?.dispose();this.freeScenes.dispose();
    this.overheadPreview.dispose();this.payloadCamera.dispose();
    this.photoConsumers.clear();
    this.internalGroundTruth.dispose();
    this.renderer.setAnimationLoop(null); this.observer.disconnect();
    this.renderer.domElement.removeEventListener('webglcontextlost',this.contextLost);
    this.scene.traverse(o=>{if(o instanceof THREE.Mesh || o instanceof THREE.LineSegments){o.geometry.dispose(); const materials=Array.isArray(o.material)?o.material:[o.material]; materials.forEach(m=>m.dispose());}});
    this.renderer.dispose(); this.renderer.domElement.remove();
  }
}

