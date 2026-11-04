import { execFileSync } from 'node:child_process';
import { lstatSync,readFileSync } from 'node:fs';

// Inspect only Git upload candidates, including tracked files that are now ignored.
// Print locations/categories, never matching credentials or private file contents.
const files=[...new Set(execFileSync('git',['ls-files','--cached','--others','--exclude-standard','-z'],{encoding:'utf8'}).split('\0').filter(Boolean))];
const findings:string[]=[];
const checks:[string,RegExp][]=[
  ['OpenAI key',/\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,}/],
  ['private key',/-----BEGIN (?:RSA |EC |OPENSSH |ENCRYPTED )?PRIVATE KEY-----/],
  ['JWT credential',/\beyJ[A-Za-z0-9_-]{25,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/],
  ['GitHub token',/\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})/],
  ['personal machine path',/(?:[A-Z]:[\\/]+Users[\\/]+[^\\/\s]+|\/(?:Users|home)\/[^/\s]+)/i],
  ['personal dynamic DNS hostname',/\b[a-z0-9-]+\.(?:ddns\.net|duckdns\.org|no-ip\.org)\b/i],
];
for(const file of files){
  if(/(^|\/)(?:ssl|node_modules|dist|\.git|\.local|\.venv[^/]*|\.sitl-test|Drone-Simulator-)(\/|$)|(?:^|\/)\.env(?:\..*)?$|\.(?:pem|key|pfx|p12|crt|cer|der|log)$/i.test(file)&&!file.endsWith('/.env.example')&&file!=='.env.example')findings.push(`${file}: private/local artifact`);
  const stat=lstatSync(file);
  if(!stat.isFile()){findings.push(`${file}: nested repository, directory or symlink; review before upload`);continue;}
  if(stat.size>25*1024*1024){findings.push(`${file}: file exceeds 25 MiB`);continue;}
  const bytes=readFileSync(file);
  if(bytes.includes(0))continue; // Binary screenshots/assets are reviewed separately.
  const lines=bytes.toString('utf8').split(/\r?\n/);
  for(const [label,pattern] of checks){
    const index=lines.findIndex(line=>pattern.test(line));
    if(index>=0)findings.push(`${file}:${index+1}: ${label}`);
  }
}
if(findings.length){console.error('Upload check failed (values omitted):\n'+findings.join('\n'));process.exitCode=1;}
else console.log(`Upload check passed: ${files.length} Git candidate files; no configured secret/private artifact patterns found. Review images and Git history separately before publishing.`);
