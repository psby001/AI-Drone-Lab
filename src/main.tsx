import { DesktopPreviews } from './components/DesktopPreviews';
import { SceneSelector } from './components/SceneSelector';
import type { FreeSceneSnapshot } from './scenes/FreeFlightScenes';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { FlightModel, LIMITS, type FlightState } from './core/flight';
import { KEY_BINDINGS, ManualController } from './input/ManualController';
import { FlightStickControls } from './components/FlightStickControls';
import { DroneScene } from './render/DroneScene';
import type { CameraMode } from './render/CameraRig';
import { WIND_PRESETS, type WindPreset } from './core/environment';
import { useGamepads } from './input/useGamepads';
import { GamepadPicker,GamepadStatusBadge,PAD_STATUS } from './components/GamepadPicker';
import { PageFullscreenButton } from './components/PageFullscreenButton';
import { MissionRunner } from './missions/MissionRunner';
import { PRESETS } from './missions/presets';
import { MissionPanel, MISSION_STATUS, stepLabel } from './components/MissionPanel';
import './style.css';
import './mobile-flight.css';
import { CameraController } from './camera/CameraController';
import type { DroneCamera } from './camera/DroneCamera';
import { CameraPanel } from './components/CameraPanel';
import { GroundTruthPanel } from './components/GroundTruthPanel';
import { huntCaptureToken,acceptHuntPhoto,type PhotoCaptureToken } from './challenges/photoHunt/bridge';
import { PhotoAlbum } from './challenges/photoHunt/PhotoAlbum';
import { publicHuntContext } from './challenges/photoHunt/publicContext';
import { readHuntProgress } from './challenges/photoHunt/rule';
import { createChallengeCatalog } from './challenges/catalog';
import { ChallengeManager } from './challenges/ChallengeManager';
import { LocalResultRepository,MemoryResultRepository } from './challenges/repository';
import { ChallengePanel } from './components/ChallengePanel';
import type { EnvironmentSettings } from './core/environment';

const emptyFree:FreeSceneSnapshot={status:'UNLOADED',active:null,requested:null,error:'',paused:false};
const noFreeSubscribe=()=>()=>{};const emptyFreeSnapshot=()=>emptyFree;
const modes = { grounded: 'Disarmed', armed: 'Armed・待起飛', flying: '飛行中', landing: '自動降落' };
const controlModes = { position: '定位模式', attitude: '姿態模式' };
const isEditable = (target: EventTarget | null) => target instanceof HTMLElement &&
  !!target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])');

function App() {
  const [developerEnabled]=useState(()=>new URLSearchParams(location.search).get('developer')==='1');
  const [sceneOpen,setSceneOpen]=useState(false),[freeNotice,setFreeNotice]=useState('');
  const sceneOpenRef=useRef(false),freeCollision=useRef(false);
  const [gtOpen,setGtOpen]=useState(false),[inspectionScene,setInspectionScene]=useState<DroneScene|null>(null);
  const freeManager=inspectionScene?.freeScenes;
  const freeSnapshot=React.useSyncExternalStore(freeManager?.subscribe??noFreeSubscribe,freeManager?.getSnapshot??emptyFreeSnapshot);
  const [payloadController]=useState(()=>new CameraController());
  const [payloadProvider,setPayloadProvider]=useState<DroneCamera|null>(null);
  const payloadSettings=React.useSyncExternalStore(payloadController.subscribe,()=>payloadController.snapshot);
  const model = useRef(new FlightModel('breeze'));
  const [missionRunner] = useState(()=>{const runner=new MissionRunner(model.current);runner.load(PRESETS[0].mission);return runner;});
  const [missionSnapshot,setMissionSnapshot] = useState(()=>structuredClone(missionRunner.snapshot));
  const [missionOpen,setMissionOpen] = useState(false);
  const [aiOpen,setAiOpen]=useState(false),[aiPrompt,setAiPrompt]=useState('');
  const controller = useRef(new ManualController());
  const host = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<DroneScene | null>(null);
  const cameraModeRef = useRef<CameraMode>('follow');
  const [cameraMode,setCameraMode] = useState<CameraMode>('follow');
  const toggleCamera = () => {
    const next = cameraModeRef.current === 'follow' ? 'fixed' : 'follow';
    cameraModeRef.current = next; setCameraMode(next); sceneRef.current?.setCameraMode(next);
  };
  const helpButton = useRef<HTMLButtonElement>(null);
  const [state, setState] = useState<FlightState>(() => structuredClone(model.current.state));
  const [error, setError] = useState('');
  const [paused, setPaused] = useState(false);
  const [help, setHelp] = useState(false);
  const [deviceSettings, setDeviceSettings] = useState(false);
  const [windPreset, setWindPreset] = useState<WindPreset>('breeze');
  const [windOpen,setWindOpen]=useState(false);
  const [windDirection, setWindDirection] = useState(90);
  const pause = useRef(false);
  const helpRef = useRef(false);
  const deviceSettingsRef = useRef(false);
  const deviceButton = useRef<HTMLButtonElement>(null);
  const savedEnvironment=useRef<EnvironmentSettings|null>(null);
  const [challengeCatalog]=useState(createChallengeCatalog);
  const [photoAlbum]=useState(()=>new PhotoAlbum());
  const [challengeOpen,setChallengeOpen]=useState(false);
  const [challengeManager]=useState(()=>{
    let repository,storageError='';try{repository=new LocalResultRepository(localStorage);}catch{repository=new MemoryResultRepository();storageError='本機儲存無法讀取，本次成績暫存於記憶體，重新整理後不保留。';}
    const manager=new ChallengeManager(challengeCatalog.registry,challengeCatalog.rules,challengeCatalog.scoring,repository,{
      clearInput:()=>{controller.current.clear();gamepads.controller.current.suspend();},
      stop:()=>{controller.current.clear();missionRunner.stop();model.current.holdPosition();},
      initialize:d=>{freeCollision.current=false;setFreeNotice('');model.current.setFlightBounds();savedEnvironment.current??={...model.current.environment};missionRunner.reset();model.current.reset(d.spawn);model.current.setEnvironment(d.scene.environment.wind,d.scene.environment.direction);setWindPreset(d.scene.environment.wind);setWindDirection(d.scene.environment.direction);if(d.objectives.some(o=>o.type==='photo-hunt')){payloadController.setEnabled(true);payloadController.setMode('stabilized');payloadController.setView('oblique');}},
    });
    if(storageError)manager.storageWarning(storageError);return manager;
  });
  const challengeSnapshot=React.useSyncExternalStore(challengeManager.subscribe,()=>challengeManager.snapshot);
  useEffect(()=>{if(challengeSnapshot.definition?.metadata.experience!=='photo-hunt')return;const ids=new Set<string>();for(const metrics of [challengeSnapshot.metrics,...challengeManager.records().map(r=>r.metrics??{})])for(const e of Object.values(readHuntProgress(metrics.treasures).best))ids.add(e.photo_id);photoAlbum.protect(ids);},[challengeSnapshot.metrics.treasures?.photo_progress,challengeManager,photoAlbum,challengeSnapshot.definition]);
  useEffect(()=>{if(['COMPLETED','FAILED','ABORTED'].includes(challengeSnapshot.status)){setChallengeOpen(true);setMissionOpen(false);}},[challengeSnapshot.status]);
  useEffect(()=>{if(challengeSnapshot.status==='IDLE'&&savedEnvironment.current){const active=sceneRef.current?.freeScenes.getActiveScene();if(active){model.current.setFlightBounds({radius:active.flight_bounds.radius,maxAltitude:active.max_altitude});model.current.reset({position:active.spawn_position,heading:active.spawn_heading});setState(structuredClone(model.current.state));}const env=savedEnvironment.current;model.current.setEnvironment(env.preset,env.direction);setWindPreset(env.preset);setWindDirection(env.direction);savedEnvironment.current=null;}},[challengeSnapshot.status]);
  const gamepads = useGamepads((state.mode === 'armed' || state.mode === 'flying') && !missionRunner.ownsControl && !challengeManager.freezesFlight && !error && !paused && !help && !deviceSettings && !sceneOpen);
  const physical = gamepads.snapshot.selected !== null;
  const toggleDeviceSettings = () => {
    challengeManager.pause();
    missionRunner.pause();setMissionSnapshot(structuredClone(missionRunner.snapshot));
    controller.current.clear(); gamepads.controller.current.suspend();
    deviceSettingsRef.current = !deviceSettingsRef.current; setDeviceSettings(deviceSettingsRef.current);
    if (!deviceSettingsRef.current) requestAnimationFrame(() => deviceButton.current?.focus());
  };
  const reset = useCallback(() => {
    if(challengeManager.active)challengeManager.abort('飛機重置，挑戰中止');else if(challengeManager.snapshot.status!=='IDLE')challengeManager.menu();
    controller.current.clear(); gamepads.controller.current.suspend(); missionRunner.reset();if(challengeManager.snapshot.status==='IDLE'){const active=sceneRef.current?.freeScenes.getActiveScene();if(active)model.current.reset({position:active.spawn_position,heading:active.spawn_heading});}freeCollision.current=false;setFreeNotice('');setMissionSnapshot(structuredClone(missionRunner.snapshot)); setState(structuredClone(model.current.state));
  }, [gamepads.controller,missionRunner,challengeManager]);
  const missionAction=(action:()=>void)=>{if(challengeManager.freezesFlight)return;controller.current.clear();gamepads.controller.current.suspend();const owned=missionRunner.ownsControl;action();if(owned&&missionRunner.snapshot.status==='stopped')challengeManager.abort('自動任務中止');setMissionSnapshot(structuredClone(missionRunner.snapshot));setState(structuredClone(model.current.state));};
  const toggleHelp = () => {
    challengeManager.pause();
    missionRunner.pause();setMissionSnapshot(structuredClone(missionRunner.snapshot));
    controller.current.clear(); gamepads.controller.current.suspend(); helpRef.current = !helpRef.current; setHelp(helpRef.current);
    if (!helpRef.current) requestAnimationFrame(() => helpButton.current?.focus());
  };
  useEffect(() => {
    let scene: DroneScene | undefined, elapsed = 0;
    const stop = () => { controller.current.clear(); gamepads.controller.current.suspend();challengeManager.pause(); missionRunner.pause();setMissionSnapshot(structuredClone(missionRunner.snapshot)); };
    const visibility = () => { stop(); pause.current = document.hidden; setPaused(document.hidden); };
    const keydown = (event: KeyboardEvent) => {
      if (isEditable(event.target) || event.ctrlKey || event.metaKey || event.altKey || event.isComposing) return;
      if (event.code === 'Escape') { stop(); helpRef.current = false; setHelp(false); deviceSettingsRef.current = false; setDeviceSettings(false); requestAnimationFrame(() => helpButton.current?.focus()); return; }
      if (helpRef.current || deviceSettingsRef.current || sceneOpenRef.current) return;
      if (event.code === 'KeyR') { event.preventDefault(); if (!event.repeat) reset(); return; }
      if (event.code in KEY_BINDINGS) {
        event.preventDefault();
        if(missionRunner.ownsControl||challengeManager.freezesFlight)return;
        if (!event.repeat && (model.current.state.mode === 'armed' || model.current.state.mode === 'flying') && gamepads.controller.current.snapshot.selected === null) controller.current.keyDown(event.code);
      }
    };
    const keyup = (event: KeyboardEvent) => {
      controller.current.keyUp(event.code);
      if (event.code in KEY_BINDINGS && !isEditable(event.target)) event.preventDefault();
    };
    window.addEventListener('keydown', keydown); window.addEventListener('keyup', keyup);
    window.addEventListener('blur', stop); window.addEventListener('pagehide', stop);
    document.addEventListener('visibilitychange', visibility);
    try {
      scene = new DroneScene(host.current!, dt => {
        if (!pause.current && !sceneOpenRef.current && !scene?.freeScenes.getSnapshot().paused && !freeCollision.current) {
          const previousFree=structuredClone(model.current.state);
          const source=missionRunner.ownsControl?'AI_MISSION' as const:'MANUAL' as const;
          if(!challengeManager.freezesFlight){
            if(missionRunner.ownsControl)missionRunner.update(dt);
            else model.current.update(dt, gamepads.controller.current.snapshot.selected !== null ? gamepads.controller.current.input : controller.current.sample());
          }
          if(challengeManager.snapshot.status==='IDLE'&&scene?.freeScenes.sample(model.current.state,previousFree).length){missionRunner.fail('碰撞：請重置或切換場景');model.current.holdPosition();freeCollision.current=true;controller.current.clear();gamepads.controller.current.suspend();setFreeNotice('碰到場景物件，飛行已暫停。請按重置或切換場景。');}
          challengeManager.update(dt,model.current.state,source,missionRunner.snapshot.status==='failed'?[{type:'mission',id:'failed'}]:[]);
        }
        elapsed += dt;
        if (elapsed > 0.1) { setState(structuredClone(model.current.state));setMissionSnapshot(structuredClone(missionRunner.snapshot)); elapsed = 0; }
        return model.current.state;
      }, message => { stop();challengeManager.abort(message); if(missionRunner.ownsControl)missionRunner.fail(message);setMissionSnapshot(structuredClone(missionRunner.snapshot));setError(message); },payloadController,()=>model.current.simulationTime,{before:()=>{controller.current.clear();gamepads.controller.current.suspend();missionRunner.stop();void scene?.payloadCamera.stopRecording().catch(()=>{});freeCollision.current=false;setFreeNotice('');setMissionSnapshot(structuredClone(missionRunner.snapshot));},initialize:d=>{missionRunner.reset();model.current.setFlightBounds({radius:d.flight_bounds.radius,maxAltitude:d.max_altitude});model.current.reset({position:d.spawn_position,heading:d.spawn_heading});model.current.setEnvironment(d.environment_settings.preset,d.environment_settings.direction);setWindPreset(d.environment_settings.preset);setWindDirection(d.environment_settings.direction);payloadController.reset();setState(structuredClone(model.current.state));setMissionSnapshot(structuredClone(missionRunner.snapshot));}});
      setPayloadProvider(scene.payloadCamera);missionRunner.setCameraPort(scene.payloadCamera);
      sceneRef.current=scene;setInspectionScene(scene);scene.setCameraMode(cameraModeRef.current);
      challengeManager.setSceneProvider(scene.createChallengeSceneProvider(challengeCatalog.scenes));
      void scene.freeScenes.loadScene('training');
    } catch { setError('無法啟動 WebGL 3D 場景，請使用支援硬體加速的瀏覽器。'); }
    return () => {
      challengeManager.setSceneProvider(null);missionRunner.setCameraPort(null);setPayloadProvider(null);
      setInspectionScene(null);scene?.dispose(); sceneRef.current=null; stop();
      window.removeEventListener('keydown', keydown); window.removeEventListener('keyup', keyup);
      window.removeEventListener('blur', stop); window.removeEventListener('pagehide', stop);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [reset, gamepads.controller,missionRunner,payloadController,challengeManager,challengeCatalog]);

  useEffect(()=>inspectionScene?.subscribeAnnotatedPhotos({prepare:()=>huntCaptureToken(challengeManager),captured:(snapshot,token)=>{acceptHuntPhoto(challengeManager,snapshot,token as PhotoCaptureToken,(id,image)=>{void photoAlbum.put(id,image);});}}),[inspectionScene,challengeManager,photoAlbum]);

  const speed = Math.hypot(state.velocity.east, state.velocity.north);
  const unavailable = (state.mode !== 'flying' && state.mode !== 'armed') || !!error || paused || help || deviceSettings || missionRunner.ownsControl || challengeManager.freezesFlight || sceneOpen || freeSnapshot.paused;
  return <div className={'app manual-app '+(missionRunner.ownsControl?'mission-active':'')+(challengeSnapshot.status!=='IDLE'?' challenge-active':'')}>
    {!help&&!deviceSettings&&<CameraPanel controller={payloadController} provider={payloadProvider} locked={missionRunner.ownsControl} heading={state.heading}/>}
    {developerEnabled&&gtOpen&&!help&&!deviceSettings&&<GroundTruthPanel scene={inspectionScene} canSwitch={challengeSnapshot.status==='IDLE'} onClose={()=>setGtOpen(false)} onLoadTest={()=>{reset();inspectionScene?.loadGroundTruthTestScene();payloadController.setEnabled(true);setMissionOpen(false);setChallengeOpen(false);}} onClearTest={()=>inspectionScene?.clearGroundTruthTestScene()} onTestFlight={()=>{if(inspectionScene?.internalGroundTruth.sceneId!=='ground-truth-test')throw new Error('請先載入 GT 測試場景');reset();payloadController.setMode('stabilized');payloadController.setView('oblique');payloadController.setEnabled(true);const errors=missionRunner.load({version:'1.2',commands:[{action:'takeoff',altitude:8},{action:'hover',duration:2},{action:'capture_photo'},{action:'land'}]});if(errors.length)throw new Error(errors.join('；'));missionRunner.start();setMissionSnapshot(structuredClone(missionRunner.snapshot));}}/>}
    <header inert={help||sceneOpen}>
      <a className="brand" href="./"><span className="brand-icon">✣</span><span>AI DRONE <b>LAB</b><small>無人機飛行實驗室</small></span></a>
      {developerEnabled&&<button className="help-button" onClick={()=>{setGtOpen(!gtOpen);setMissionOpen(false);setChallengeOpen(false);}}>開發者 GT</button>}
      <button className="help-button" disabled={challengeSnapshot.status!=='IDLE'||!freeManager} onClick={()=>{controller.current.clear();gamepads.controller.current.suspend();sceneOpenRef.current=true;setSceneOpen(true);setMissionOpen(false);setChallengeOpen(false);setGtOpen(false);}}>場景</button>
      <button className="help-button" disabled={freeSnapshot.status!=='ACTIVE'} aria-expanded={challengeOpen} onClick={()=>{controller.current.clear();gamepads.controller.current.suspend();setMissionOpen(false);setChallengeOpen(!challengeOpen);}}>挑戰</button>
      <button className="help-button camera-toggle" title="顯示或隱藏預覽；關閉視窗不會中斷錄影" aria-expanded={payloadSettings.enabled} onClick={()=>{const reveal=missionOpen||deviceSettings||!payloadSettings.enabled;if(reveal){setMissionOpen(false);if(deviceSettings)toggleDeviceSettings();}payloadController.setEnabled(reveal);}}>{payloadProvider?.getSnapshot().recording?'● 相機錄影中':'📷 相機'}</button>
      <div className="controller-tools"><PageFullscreenButton/><button className="help-button ai-entry" aria-expanded={missionOpen&&aiOpen} aria-controls="mission-panel" onClick={()=>{controller.current.clear();gamepads.controller.current.suspend();setChallengeOpen(false);setAiOpen(true);setMissionOpen(true);}}>✦ AI 編程</button><button className="help-button" aria-expanded={missionOpen} aria-controls="mission-panel" onClick={()=>{controller.current.clear();gamepads.controller.current.suspend();setChallengeOpen(false);setAiOpen(false);setMissionOpen(!missionOpen);}}>任務</button><button ref={deviceButton} className={'help-button '+(physical?'selected-device':'')} onClick={toggleDeviceSettings} title={PAD_STATUS[gamepads.snapshot.status]} aria-label={`${physical?'實體手把':'控制裝置'}，${PAD_STATUS[gamepads.snapshot.status]}`} aria-expanded={deviceSettings} aria-controls="gamepad-settings">🎮 {physical ? '實體手把' : '控制裝置'}<GamepadStatusBadge status={gamepads.snapshot.status}/></button><button ref={helpButton} className="help-button" onClick={toggleHelp} aria-expanded={help} aria-controls="flight-help">? 操作說明</button></div>
    </header>
    <main inert={help}>
      {!help&&!deviceSettings&&<ChallengePanel telemetry={{altitude:state.position.up,speed,heading:state.heading}} photoAlbum={photoAlbum} onPhoto={async()=>{if(!payloadProvider||challengeManager.snapshot.status!=='RUNNING')return;return payloadProvider.capturePhoto();}} canTakeover={missionRunner.ownsControl} onTakeover={()=>{if(challengeManager.snapshot.status!=='RUNNING')return;controller.current.clear();gamepads.controller.current.suspend();missionRunner.stop();setMissionSnapshot(structuredClone(missionRunner.snapshot));}} manager={challengeManager} open={challengeOpen} onOpen={()=>{setMissionOpen(false);setChallengeOpen(true);}} onClose={()=>setChallengeOpen(false)} onExample={value=>{missionRunner.load(value);setMissionSnapshot(structuredClone(missionRunner.snapshot));if(challengeManager.snapshot.status==='RUNNING'){setChallengeOpen(false);setMissionOpen(true);}}}/>}
      {missionOpen&&<MissionPanel publicContext={publicHuntContext(challengeSnapshot.definition)} blocked={!!error||challengeManager.freezesFlight} runner={missionRunner} snapshot={missionSnapshot} onAction={missionAction} onReset={reset} onClose={()=>setMissionOpen(false)} aiOpen={aiOpen} onAiOpen={setAiOpen} aiPrompt={aiPrompt} onAiPrompt={setAiPrompt}/>}
      {deviceSettings && <GamepadPicker snapshot={gamepads.snapshot} onSelect={index => { controller.current.clear(); gamepads.select(index); }} onClose={toggleDeviceSettings}/>}
      <section className="workspace">
        <DesktopPreviews scene={inspectionScene}/>
        <div ref={host} className="viewport"/>
        <div className="scene-top"><span className="tag">MANUAL FLIGHT / MODE 2</span><h1>掌握方向，<br/>自由探索。</h1><p>橘色燈條為機頭 · Arm 後推升降桿起飛</p></div>
        <div className="flight-hud" aria-label="即時飛行資訊">
          <span><small>高度</small><b>{state.position.up.toFixed(1)}<em> m</em></b></span>
          <span><small>水平速度</small><b>{speed.toFixed(1)}<em> m/s</em></b></span>
          <span><small>航向</small><b>{state.heading.toFixed(0)}°</b></span>
          <span className="hud-mode">{paused ? '分頁暫停' : modes[state.mode]}<small>{controlModes[state.controlMode]}</small></span>
        </div>
        <button className="view-chip camera-switch" onClick={toggleCamera} aria-label={`切換視角，目前為${cameraMode==='follow'?'第三人稱跟隨':'固定觀察'}`} title={cameraMode==='follow'?'切換到固定位置，僅轉動方向追蹤無人機':'切換到第三人稱跟隨'}>◉ {cameraMode==='follow'?'跟隨視角':'固定視角'} <span>⇄</span></button>
        <div className={`wind-control-shell ${windOpen?'is-open':''}`}>
        <button className="mobile-wind-toggle" aria-label="風力設定" aria-expanded={windOpen} aria-controls="wind-settings" onClick={()=>{controller.current.clear();gamepads.controller.current.suspend();setWindOpen(!windOpen);}}>風力 {Math.hypot(state.wind.east,state.wind.north).toFixed(1)} <small>m/s {windOpen?'▴':'▾'}</small></button>
        <section id="wind-settings" className="environment-controls" aria-label="環境風力">
          <label>環境風力<select disabled={challengeSnapshot.status!=='IDLE'} value={windPreset} onChange={event => { const preset = event.target.value as WindPreset; setWindPreset(preset); model.current.setEnvironment(preset, windDirection); }}>{Object.entries(WIND_PRESETS).map(([key, preset]) => <option key={key} value={key}>{preset.label}{preset.speed ? ` ${preset.speed} m/s` : ''}</option>)}</select></label>
          <label>吹向<select disabled={challengeSnapshot.status!=='IDLE'} value={windDirection} onChange={event => { const direction = Number(event.target.value); setWindDirection(direction); model.current.setEnvironment(windPreset, direction); }}><option value={0}>北 ↑</option><option value={90}>東 →</option><option value={180}>南 ↓</option><option value={270}>西 ←</option></select></label>
          <span className="wind-reading">即時 {Math.hypot(state.wind.east, state.wind.north).toFixed(1)} m/s <small>{state.controlMode === 'position' ? '定位・放桿煞停' : '姿態・風中漂移'}</small></span>
        </section>
        </div>
        <div className="compass"><b>N</b><span style={{ transform: `rotate(${-state.heading}deg)` }}>↑</span><small>{state.heading.toFixed(0).padStart(3, '0')}°</small></div>
        <div className="scene-bottom"><span><i/> {paused ? '分頁暫停' : modes[state.mode]} · {controlModes[state.controlMode]}</span><span>{challengeSnapshot.status==='IDLE'?freeSnapshot.active?.title+' · ':''}半徑 {model.current.flightBounds.radius}m 飛行區域 <em>·</em> 高度上限 {model.current.flightBounds.maxAltitude}m</span></div>
        {missionRunner.ownsControl&&<div className="mission-brief" role="status"><b>自動任務・{MISSION_STATUS[missionSnapshot.status]}</b><span>{missionSnapshot.index+1}/{missionRunner.plan?.steps.length}　{missionRunner.plan&&stepLabel(missionRunner.plan.steps[missionSnapshot.index])}</span><div><button onClick={()=>missionAction(()=>missionSnapshot.status==="paused"?missionRunner.resume():missionRunner.pause())}>{missionSnapshot.status==="paused"?"繼續":"暫停"}</button><button onClick={()=>missionAction(()=>missionRunner.stop())}>停止</button><button onClick={()=>setMissionOpen(true)}>詳情</button></div></div>}{!missionOpen&&["completed","failed","stopped"].includes(missionSnapshot.status)&&<div className="mission-result" role="status">{MISSION_STATUS[missionSnapshot.status]}：{missionSnapshot.message}<button onClick={()=>setMissionOpen(true)}>查看任務</button></div>}{error && <div className="error" role="alert">{error}</div>}
        {freeNotice&&<div className="notice" role="status">{freeNotice}</div>}
        {state.boundary && <div className="notice" role="status">已到達飛行邊界，請往區域內移動</div>}
      </section>
      <aside>
        <div className="panel-heading"><div><span className="eyebrow">FLIGHT TELEMETRY</span><h2>飛行儀表</h2></div><span className={'status ' + (state.mode === 'grounded' ? '' : 'active')}>{modes[state.mode]}</span></div>
        <div className="metrics"><div><span>相對高度</span><strong>{state.position.up.toFixed(1)}<small>m</small></strong><div className="meter"><i style={{ width: `${state.position.up / model.current.flightBounds.maxAltitude * 100}%` }}/></div></div><div><span>水平速度</span><strong>{speed.toFixed(1)}<small>m/s</small></strong><div className="meter"><i style={{ width: `${speed / (state.controlMode === 'attitude' ? LIMITS.attitudeMaxSpeed : LIMITS.maxSpeed) * 100}%` }}/></div></div></div>
        <div className="coordinates"><span>位置 <small>ENU / 公尺</small></span><div><p>E <b>{state.position.east.toFixed(2)}</b></p><p>N <b>{state.position.north.toFixed(2)}</b></p><p>U <b>{state.position.up.toFixed(2)}</b></p></div><span>航向 <b>{state.heading.toFixed(1)}°</b></span><span>垂直速度 <b>{state.velocity.up.toFixed(2)} m/s</b></span><span>俯仰 / 側傾 <b>{state.attitude.pitch.toFixed(1)}° / {state.attitude.roll.toFixed(1)}°</b></span><span>空速 / 推力 <b>{state.airspeed.toFixed(1)} m/s / {state.thrust.toFixed(1)} N</b></span></div>
        <section className="flight-controls" aria-label="手動飛行控制">
          <div className="control-title"><h2>手動控制</h2><span>MODE 2 · 自動回中</span></div>
          <div className="actions">
            <button className="primary" title={state.mode === 'flying' || state.mode === 'landing' ? '請先降落，再 Disarm 停止馬達' : 'Arm 啟動馬達，Disarm 停止馬達'} disabled={state.mode === 'flying' || state.mode === 'landing' || !!error || help || deviceSettings || missionRunner.ownsControl || challengeManager.freezesFlight} onClick={() => { controller.current.clear(); gamepads.controller.current.suspend(); if (model.current.state.mode === 'grounded') model.current.arm(); else model.current.disarm(); setState(structuredClone(model.current.state)); }}>{state.mode === 'grounded' ? 'Arm' : 'Disarm'}</button>
            <button disabled={state.mode !== 'flying' || !!error || help || deviceSettings || missionRunner.ownsControl || challengeManager.freezesFlight} onClick={() => { controller.current.clear(); gamepads.controller.current.suspend(); model.current.land(); setState(structuredClone(model.current.state)); }}>↘ 降落</button>
            <button onClick={reset}>↺ 重置 <kbd>R</kbd></button>
            <button className={state.controlMode === 'attitude' ? 'attitude-mode-button' : ''} disabled={state.mode === 'landing' || !!error || help || deviceSettings || missionRunner.ownsControl || challengeManager.freezesFlight} aria-label={`切換飛行模式，目前為${controlModes[state.controlMode]}`} title={state.controlMode === 'position' ? '切換姿態模式：放桿回正但不定位，會受風與慣性漂移' : '切換定位模式：自動煞停並保持位置'} onClick={() => { controller.current.clear(); gamepads.controller.current.suspend(); model.current.setControlMode(model.current.state.controlMode === 'position' ? 'attitude' : 'position'); setState(structuredClone(model.current.state)); }}>⇄ {controlModes[state.controlMode]}</button>
          </div>
          <p className="mode-explainer" role="status">{state.mode === 'grounded' ? '先 Arm 啟動馬達，再推左桿向上／按 W 自行起飛。' : state.mode === 'armed' ? '馬達怠速中：推左桿向上／按 W 起飛，或 Disarm 停止。' : state.mode === 'landing' ? '自動降落使用定位輔助，落地後請 Disarm。' : state.controlMode === 'position' ? '定位模式：放桿後自動煞停、抗風並保持位置。' : '姿態模式：放桿回正但不煞停，會受風與慣性漂移；保留定高。'}</p>
          <FlightStickControls snapshot={gamepads.snapshot} controller={controller.current} disabled={unavailable} mode={state.mode} controlMode={state.controlMode}/>
        </section>
        {!physical && <div className="keyboard-guide"><h3>鍵盤飛行</h3><p><kbd>W</kbd> / <kbd>S</kbd> 上升／下降 <kbd>Q</kbd> / <kbd>E</kbd> 左／右轉</p><p><kbd>↑</kbd> / <kbd>↓</kbd> 前進／後退 <kbd>←</kbd> / <kbd>→</kbd> 左／右移</p><small>可同時按鍵；橫向使用手機，可獲得更好的操作空間。</small></div>}
      </aside>
    </main>
    <footer inert={help}><span>AI Drone Lab · 無人機飛行實驗室</span><span>ENU 世界座標 · 北向 0° · 順時針為正</span><span>飛行模擬 · AI 編程 · 挑戰關卡</span></footer>
    {sceneOpen&&freeManager&&<SceneSelector manager={freeManager} needsConfirmation={state.mode!=='grounded'||missionRunner.ownsControl} onClose={()=>{sceneOpenRef.current=false;setSceneOpen(false);controller.current.clear();gamepads.controller.current.suspend();}}/>}
    {help && <div className="help-backdrop"><section id="flight-help" className="help-panel" role="dialog" aria-modal="true" aria-labelledby="help-title">
      <h2 id="help-title">準備好第一次飛行</h2><ol><li>按「Arm」啟動螺旋槳，無人機仍在地面。</li><li>左桿向上／W 控制爬升，自行決定起飛高度。左桿左右轉向；右桿前後左右控制移動。</li><li>定位模式放桿會煞停、抗風定位；姿態模式右桿直接控制傾角，放桿回正但會繼續滑行或被風吹走。</li><li>兩種模式保留定高輔助，不需要配平油門。按模式按鈕可切換；回定位模式會先煞車，不會跳回舊位置。</li><li>下拉左桿自行降落，或按「降落」使用自動降落輔助。落地後馬達仍怠速，按「Disarm」停槳。空中不能 Disarm；「重置」或 R 回到平台並停槳。</li></ol>
      <p>實體手把：按右上「控制裝置」選擇 Xbox 或 PS5 DualSense。以 USB／藍牙連接後按任一手把按鈕；選用後虛擬搖桿隱藏。Arm、切換裝置／模式或返回視窗後先回中，再推左桿起飛。斷線會清除輸入並恢復虛擬搖桿；姿態模式仍會漂移，可切回定位模式煞停。</p>
      <p>電腦：W／S 升降，Q／E 轉向，方向鍵以機頭為基準控制移動／傾角。Esc 清除輸入並關閉說明，不會將姿態模式改成定位。</p><p>可選無風、微風或強風，「吹向」指風前往的方向。標示風速為 8 公尺高度基準值，實際含高度變化與陣風。定位水平限速 {LIMITS.maxSpeed}m/s，姿態安全限速 {LIMITS.attitudeMaxSpeed}m/s；高度上限 {model.current.flightBounds.maxAltitude}m、垂直限速 {LIMITS.verticalSpeed}m/s。</p><p>切換分頁會暫停模擬並清除輸入，返回後不補跑；失焦只清除輸入，姿態模式慣性與漂移仍持續。</p>
      <button autoFocus className="primary" onClick={toggleHelp}>了解，開始飛行</button>
    </section></div>}
  </div>;
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><App/></React.StrictMode>);




