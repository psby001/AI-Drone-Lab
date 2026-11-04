import { readFile,mkdir,writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { generatePython } from '../src/dronekit/generate';
import { PRESETS } from '../src/missions/presets';
const python=process.env.DRONEKIT_PYTHON??(process.platform==='win32'?'.venv-dronekit/Scripts/python.exe':'.venv-dronekit/bin/python');
await mkdir('public/dronekit',{recursive:true});
const plans:unknown[]=[];
for(const preset of PRESETS){
  const artifact=await generatePython(preset.mission);
  const file=`public/dronekit/${preset.id}.py`;
  await writeFile(file,artifact.code);
  const result=spawnSync(python,[file,'--check'],{encoding:'utf8',timeout:15000,windowsHide:true});
  if(result.status!==0)throw new Error(result.stderr||result.error?.message||'Python check failed');
  plans.push(JSON.parse(Buffer.from(artifact.code.match(/^PLAN_B64 = "([^"]+)"/m)![1],'base64').toString()));
}
const checked=spawnSync(python,['python/test_drone_controller.py'],{input:JSON.stringify(plans),encoding:'utf8',timeout:30000,windowsHide:true});
if(checked.status!==0)throw new Error(checked.stderr||checked.error?.message||'Runtime tests failed');
const versions=spawnSync(python,['-c',"import platform,json,importlib.metadata as m;print(json.dumps(dict(python=platform.python_version(),dronekit=m.version('dronekit'),pymavlink=m.version('pymavlink'),future=m.version('future'))))"],{encoding:'utf8',windowsHide:true});
if(versions.status!==0)throw new Error(versions.stderr);
const runtimeSha256=createHash('sha256').update(await readFile('python/drone_controller.py','utf8')).digest('hex');
const report={checkedAt:new Date().toISOString(),runtimeSha256,versions:JSON.parse(versions.stdout),ardupilot:null,sitlVerified:false,syntaxCheckedPresets:PRESETS.map(p=>p.id),apiImportAndEncoding:true,fakeVehicleExecution:true,notes:['This verification command covers static and fake-vehicle checks only, not ArduPilot SITL.','Fake vehicle tests are not SITL verification.']};
await writeFile('docs/dronekit-validation.json',JSON.stringify(report,null,2)+'\n');
console.log(checked.stdout);console.log('Generated scripts and report: public/dronekit/ and docs/dronekit-validation.json');
