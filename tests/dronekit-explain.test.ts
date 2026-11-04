import { it } from 'node:test';
import assert from 'node:assert/strict';
import { generatePython } from '../src/dronekit/generate';
import { pythonDefinition } from '../src/dronekit/explain';
import { PRESETS } from '../src/missions/presets';
it('implementation excerpts are exact downloadable source, including the actual movement MAVLink call',async()=>{
  for(const preset of PRESETS){
    const artifact=await generatePython(preset.mission);
    for(const step of artifact.steps){
      assert.ok(step.implementation?.snippets.length);
      for(const snippet of step.implementation!.snippets){
        const lines=snippet.code.split('\n');
        assert.equal(artifact.code.split('\n').slice(snippet.line-1,snippet.line-1+lines.length).join('\n'),snippet.code);
      }
    }
  }
  const artifact=await generatePython(PRESETS[1].mission);
  const movement=artifact.steps[1].implementation!;
  assert.match(movement.explanation,/沒有原生 move_forward/);
  const send=movement.snippets.find(s=>s.name==='DroneController.send_target')!;
  assert.match(send.code,/set_position_target_local_ned_encode\(/);
  assert.match(send.code,/MAV_FRAME_LOCAL_NED, 2496/);
  assert.match(send.code,/self.v.send_mavlink\(message\)/);
  assert.match(movement.snippets.find(s=>s.name==='DroneController.track')!.code,/self.send_target\(/);
  assert.deepEqual(artifact.steps[1].target,{east:0,north:8,up:4,heading:0});
});
it('method extraction disambiguates teaching API and controller implementations, including decorators',async()=>{
  const {code}=await generatePython(PRESETS[0].mission);
  assert.match(pythonDefinition(code,'FlightCommands','takeoff').code,/self._command/);
  const actual=pythonDefinition(code,'DroneController','takeoff').code;
  assert.match(actual,/self.v.simple_takeoff/);
  assert.ok(!actual.includes('def track'));
  assert.match(pythonDefinition(code,'FlightCommands','parallel').code,/^    @contextmanager/);
  assert.throws(()=>pythonDefinition(code,'Missing','takeoff'));
  assert.throws(()=>pythonDefinition(code,'FlightCommands','track'));
});
