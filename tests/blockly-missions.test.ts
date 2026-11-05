import {it} from 'node:test';
import assert from 'node:assert/strict';
import * as Blockly from 'blockly';
import {missionToState,workspaceToMission,blockSpecs,savedWorkspace,readSavedWorkspace} from '../src/blockly/missionBlocks';
import {PRESETS} from '../src/missions/presets';
import {CAMERA_PRESETS} from '../src/camera/presets';
import {missionSchema} from '../src/missions/schema';
import {MissionRunner} from '../src/missions/MissionRunner';
import {FlightModel} from '../src/core/flight';
import {generatePython} from '../src/dronekit/generate';
import type {Mission} from '../src/missions/types';
function roundtrip(mission:Mission){const w=new Blockly.Workspace();try{Blockly.serialization.workspaces.load(missionToState(mission),w);const result=workspaceToMission(w);assert.deepEqual(result,mission);return result;}finally{w.dispose();}}
it('every schema action has a block, and every existing flight/camera preset roundtrips exactly',()=>{
  const actions=new Set(missionSchema.definitions.command.oneOf.flatMap(v=>{const a=v.properties.action as {const?:string;enum?:string[]};return a.enum??[a.const!];}));
  for(const action of actions)assert.ok([...blockSpecs.values()].some(s=>s.action===action),action);
  for(const p of [...PRESETS,...CAMERA_PRESETS])roundtrip(p.mission);
});
it('preserves optional parameters, GPS metadata, angles and nested parallel/repeat order',()=>{
  roundtrip({name:'完整參數',version:'1.2',home:{latitude:0,longitude:0},commands:[{action:'set_speed',speed:2,vertical_speed:1},{action:'takeoff',altitude:5,speed:1},{action:'repeat',count:2,commands:[{action:'parallel',reference_frame:'start',commands:[{action:'move_forward',distance:2,speed:1},{action:'turn_left',angle:90,speed:40}]}]},{action:'goto_gps',latitude:0.00001,longitude:0.00001,altitude:4,speed:1},{action:'land'}]});
});
it('Blockly generated square executes through original physics and generates readable DroneKit Python',async()=>{
  const mission=roundtrip(PRESETS.find(p=>p.id==='square')!.mission),model=new FlightModel('calm'),runner=new MissionRunner(model);assert.deepEqual(runner.load(mission),[]);assert.ok(runner.start());for(let i=0;i<21600&&runner.ownsControl;i++)runner.update(1/120);assert.equal(runner.snapshot.status,'completed');const python=await generatePython(mission);assert.match(python.code,/drone\.move_forward/);
});
it('saves and loads actual Blockly workspace state; rejects unsupported input and loose/disabled blocks',()=>{
  const w=new Blockly.Workspace(),loaded=new Blockly.Workspace();try{
    Blockly.serialization.workspaces.load(missionToState(PRESETS[0].mission),w);const saved=JSON.stringify(savedWorkspace(w));Blockly.serialization.workspaces.load(readSavedWorkspace(saved),loaded);assert.deepEqual(workspaceToMission(loaded),PRESETS[0].mission);
    w.newBlock('drone_land');assert.throws(()=>workspaceToMission(w),/任務起點/);
    assert.throws(()=>readSavedWorkspace(JSON.stringify({format:'ai-drone-blockly',version:1,workspace:{blocks:{blocks:[{type:'controls_if'}]}}})),/未支援/);
    assert.throws(()=>missionToState({commands:[{action:'takeoff',altitude:100},{action:'land'}]}));
    assert.throws(()=>readSavedWorkspace('{}'));
  }finally{w.dispose();loaded.dispose();}
});
