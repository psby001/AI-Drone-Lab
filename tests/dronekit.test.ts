import { it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile,mkdtemp,writeFile,rm,rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { generatePython } from '../src/dronekit/generate';
import { PYTHON_RUNTIME } from '../src/dronekit/runtime.generated';
import { PRESETS } from '../src/missions/presets';
import { validateMission } from '../src/missions/validate';
import { parallelSample } from '../src/missions/parallel';
it('Python template matches its browser copy',async()=>{
  assert.equal(PYTHON_RUNTIME,await readFile('python/drone_controller.py','utf8'));
});
it('all mission presets generate complete, syntax-valid Python with exact compiled-plan semantics',async()=>{
  const folder=await mkdtemp(join(tmpdir(),'dronekit-test-'));
  try{
    for(const preset of PRESETS){
      const artifact=await generatePython(preset.mission);
      const payload=JSON.parse(Buffer.from(artifact.code.match(/^PLAN_B64 = "([^"]+)"/m)![1],'base64').toString());
      const plan=validateMission(preset.mission).plan!;
      assert.deepEqual(payload.steps,plan.steps,preset.id);
      assert.deepEqual(payload.mission,preset.mission);
      for(const step of artifact.steps){const line=artifact.code.split('\n')[step.line-1];assert.match(line,/^    (?:drone\.[a-z_]+\(|with drone.parallel\()/);assert.ok(!line.includes('execute_step'));}
      assert.ok(!artifact.missionCode.includes('PLAN_B64'));
      assert.ok(artifact.code.indexOf('def run_mission(drone):')<artifact.code.indexOf('class DroneController'));
      const file=join(folder,preset.id+'.py');await writeFile(file,artifact.code);
      const result=spawnSync('py',['-3.9',file,'--check'],{encoding:'utf8',timeout:15000,windowsHide:true});
      assert.equal(result.status,0,preset.id+result.stdout+result.stderr);
      assert.match(result.stdout,/Static checks passed.*SITL NOT verified/);
      assert.match(result.stdout,/CHECK ONLY: no connection opened and no flight commands sent/);
      if(preset.id==='up-down'){
        await writeFile(file,artifact.code.replace('drone.takeoff(altitude=3)','drone.takeoff(altitude=4)'));
        const changed=spawnSync('py',['-3.9',file,'--check'],{encoding:'utf8',timeout:15000,windowsHide:true});
        assert.notEqual(changed.status,0);assert.match(changed.stderr,/differs from validated mission/);
        await writeFile(file,artifact.code);
      }
      const refused=spawnSync('py',['-3.9',file,'--execute-sitl','--connect','tcp:192.168.1.1:5760'],{encoding:'utf8',timeout:15000,windowsHide:true});
      assert.notEqual(refused.status,0);assert.match(refused.stderr,/loopback/);
    }
  }finally{for(const file of PRESETS)await rm(join(folder,file.id+'.py'),{force:true});await rmdir(folder);}
});
it('rejects invalid missions and keeps untrusted text entirely inside JSON data',async()=>{
  await assert.rejects(generatePython({commands:[{action:'takeoff',altitude:99},{action:'land'}]}));
  const mission={...PRESETS[0].mission,name:'"\n__import__("os").system("no")\n#<script>測試'};
  const artifact=await generatePython(mission);
  assert.ok(!artifact.code.includes('__import__'));
  assert.ok(!artifact.code.includes('<script>'));
});
it('Python trajectories match the simulator at every sampled phase (both reference frames)',async()=>{
  const cases=PRESETS.flatMap(p=>validateMission(p.mission).plan!.steps.filter(s=>s.trajectory).map(s=>({trajectory:s.trajectory,samples:Array.from({length:21},(_,i)=>parallelSample(s.trajectory!,s.trajectory!.duration*i/20))})));
  const result=spawnSync('py',['-3.9','python/test_drone_controller.py','--samples'],{input:JSON.stringify(cases),encoding:'utf8',timeout:15000,windowsHide:true});
  assert.equal(result.status,0,result.stdout+result.stderr);
});
it('fixed runtime safety, coordinate, real API and fake-vehicle execution tests pass',async()=>{
  const plans=PRESETS.map(p=>({...validateMission(p.mission).plan!,limits:{}}));
  // Use the exact compiler payload (including centralized limits).
  for(let i=0;i<plans.length;i++){const a=await generatePython(PRESETS[i].mission);plans[i]=JSON.parse(Buffer.from(a.code.match(/^PLAN_B64 = "([^"]+)"/m)![1],'base64').toString());}
  const result=spawnSync('.venv-dronekit/Scripts/python.exe',['python/test_drone_controller.py'],{input:JSON.stringify(plans),encoding:'utf8',timeout:30000,windowsHide:true});
  assert.equal(result.status,0,result.stdout+result.stderr);
  assert.match(result.stdout,/dronekit 2.9.2/);
});
