import { readFile,writeFile,mkdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
const runtime=await readFile('python/drone_controller.py','utf8');
let syntax={passed:false,python:'未檢查'};
for(const [program,args] of [['py',['-3.9']],['python',[]]] as const){
  const result=spawnSync(program,[...args,'-c','import ast,sys,platform; ast.parse(sys.stdin.read()); print(platform.python_version())'],{input:runtime,encoding:'utf8',timeout:10000,windowsHide:true});
  if(result.status===0){syntax={passed:true,python:result.stdout.trim()};break;}
}
let api:{passed:boolean;versions?:{dronekit:string;pymavlink:string};checkedAt?:string}={passed:false};
try{const report=JSON.parse(await readFile('docs/dronekit-validation.json','utf8'));if(report.runtimeSha256===createHash('sha256').update(runtime).digest('hex')&&report.apiImportAndEncoding&&report.fakeVehicleExecution)api={passed:true,versions:{dronekit:report.versions.dronekit,pymavlink:report.versions.pymavlink},checkedAt:report.checkedAt};}catch{/* No report is an explicit unchecked status. */}
await mkdir('src/dronekit',{recursive:true});
await writeFile('src/dronekit/runtime.generated.ts',`// Generated from python/drone_controller.py by scripts/export-dronekit.ts.\nexport const PYTHON_RUNTIME=${JSON.stringify(runtime)};\nexport const TEMPLATE_SYNTAX=${JSON.stringify(syntax)};\nexport const TEMPLATE_API:{passed:boolean;versions?:{dronekit:string;pymavlink:string};checkedAt?:string}=${JSON.stringify(api)};\n`);
console.log(`DroneKit template syntax: ${syntax.passed?'passed':'not checked'} (${syntax.python})`);
