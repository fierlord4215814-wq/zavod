'use strict';
// Artifact preparation only. Explicit source/config/migration/harness allowlist; no imports, env reads or runtime.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),cp=require('node:child_process');
const root=path.resolve(__dirname,'../../../../../..');
if(root.toLowerCase()!=='c:\\users\\79164\\documents\\work')throw Error('Unexpected repository root');
const batch=path.resolve(__dirname,'../..'),prior=path.join(batch,'attempts/20260918-hyperv-ubuntu24/post-reboot-20260919/baseline.json');
const base=JSON.parse(fs.readFileSync(prior,'utf8'));
const runtime=path.join(root,'.r5-runtime/master-r5-ubuntu24'),stage=path.join(runtime,'clean-source-20260920-01');
const archive=path.join(runtime,'clean-source-20260920-01.tar'),manifestPath=path.join(__dirname,'source-payload-manifest.json');
for(const p of [stage,archive,manifestPath])if(fs.existsSync(p))throw Error('Preserve existing source payload attempt: '+p);
const configs=['package.json','package-lock.json','backend/package.json','backend/tsconfig.json','backend/tsconfig.build.json','backend/prisma/schema.prisma','frontend/package.json','frontend/tsconfig.json','frontend/vite.config.ts','frontend/index.html'];
const trees=['backend/src/','frontend/src/','frontend/public/','backend/prisma/migrations/'];
const discovered=cp.execFileSync('rg',['--files',...trees.map(x=>x.slice(0,-1))],{cwd:root,encoding:'utf8',windowsHide:true}).trim().split(/\r?\n/).map(x=>x.replaceAll('\\','/'));
const inheritedHarness=base.groups.find(g=>g.kind==='harness').files.map(f=>f.owner);
const harness=inheritedHarness.filter(name=>/^(backend\/scripts\/|frontend\/scripts\/|frontend\/e2e\/)/.test(name));
const excludedHandoffOnly=inheritedHarness.filter(name=>!harness.includes(name));
const names=[...new Set([...configs,...discovered,...harness])].sort();
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
function approved(name,identityOnly=false){
 if(!configs.includes(name)&&!trees.some(t=>name.startsWith(t))&&!harness.includes(name)&&!(identityOnly&&inheritedHarness.includes(name)))throw Error('Path outside source allowlist');
 if(/(^|\/)(\.env[^/]*|uploads|\.git|node_modules|credentials|cookies[^/]*|storageState[^/]*|private|backups|dumps)(\/|$)/i.test(name)||/\.(db|sqlite|dump|bak|key|pfx|p12|pem)$/i.test(name)||/prisma\/seed/i.test(name))throw Error('Excluded source path: '+name);
 const full=path.resolve(root,name),rel=path.relative(root,full);if(rel.startsWith('..')||path.isAbsolute(rel))throw Error('Escaped source root');
 for(let q=full;q!==root;q=path.dirname(q))if(fs.lstatSync(q).isSymbolicLink())throw Error('Reparse source path');
 if(!fs.statSync(full).isFile()||fs.statSync(full).size>20*1024*1024)throw Error('Unexpected source entry/size');return full;
}
for(const p of [runtime,path.dirname(runtime)])if(fs.lstatSync(p).isSymbolicLink())throw Error('Reparse runtime path');
const records=names.map(name=>{const full=approved(name),bytes=fs.readFileSync(full);if(/\.(ts|tsx|js|cjs|json|sql|toml|html|svg|css|webmanifest)$/i.test(name)){
 const text=bytes.toString('utf8');if(/-----BEGIN (?:RSA |EC |DSA |OPENSSH |ENCRYPTED |PGP )?PRIVATE KEY(?: BLOCK)?-----/.test(text)||/postgres(?:ql)?:\/\/[^\s/:"'<>]+:[^\s@"'<>]+@/.test(text))throw Error('Potential private material in allowlisted source; values suppressed: '+name);
 }return{name,bytes:bytes.length,sha256:sha(bytes)};});
const canonical=base.groups.filter(g=>g.kind!=='build').map(g=>({kind:g.kind,files:g.files.map(f=>({owner:f.owner,expected:f.sha256,current:sha(fs.readFileSync(approved(f.owner,true)))}))}));
if(canonical.some(g=>g.files.some(f=>f.expected!==f.current)))throw Error('Canonical product/harness drift; preserve and inspect before transfer');
fs.mkdirSync(stage);
for(const r of records){const dest=path.join(stage,r.name);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.copyFileSync(approved(r.name),dest,fs.constants.COPYFILE_EXCL);if(sha(fs.readFileSync(dest))!==r.sha256)throw Error('Source copy readback mismatch');}
const identity=sha(JSON.stringify(records));
const manifest={at:new Date().toISOString(),status:'CLEAN_ALLOWLIST_SOURCE_PAYLOAD_NOT_EXECUTED',productSourceFingerprint:identity,canonical,records,excludedHandoffOnly:excludedHandoffOnly.map(name=>({name,reason:'Host report/retention helper, not guest runtime or named Node/browser test; all inherited hashes still checked'})),excluded:['.env','uploads','.git','credentials','cookies','storageState','private keys','DB/dumps','protected historical snapshots','node_modules','Windows dist','production seed'],workingDbAccessed:false,productExecuted:false};
fs.writeFileSync(path.join(stage,'r5-source-manifest.json'),JSON.stringify(manifest,null,2),{flag:'wx'});
cp.execFileSync('C:\\Windows\\System32\\tar.exe',['-cf',archive,'-C',stage,...records.map(r=>r.name),'r5-source-manifest.json'],{cwd:root,encoding:'utf8',windowsHide:true,maxBuffer:2*1024*1024});
const list=cp.execFileSync('C:\\Windows\\System32\\tar.exe',['-tf',archive],{encoding:'utf8',windowsHide:true}).trim().split(/\r?\n/);
if(list.length!==records.length+1||new Set(list).size!==list.length||records.some(r=>!list.includes(r.name))||!list.includes('r5-source-manifest.json'))throw Error('Tar allowlist readback mismatch');
for(const r of records){const b=cp.execFileSync('C:\\Windows\\System32\\tar.exe',['-xOf',archive,r.name],{encoding:null,windowsHide:true,maxBuffer:22*1024*1024});if(b.length!==r.bytes||sha(b)!==r.sha256)throw Error('Tar byte readback mismatch: '+r.name);}
const packed={...manifest,archive:{path:archive,bytes:fs.statSync(archive).size,sha256:sha(fs.readFileSync(archive)),entryCount:list.length,fullSourceEntryReadback:true},canaryRoundTrip:'NOT_RUN',isolation:'NOT_RUN'};
fs.writeFileSync(manifestPath,JSON.stringify(packed,null,2),{flag:'wx'});
console.log(JSON.stringify({status:packed.status,sourceFiles:records.length,archive:packed.archive,productExecuted:false}));
