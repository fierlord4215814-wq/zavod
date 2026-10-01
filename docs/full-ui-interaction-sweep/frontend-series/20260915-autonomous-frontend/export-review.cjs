const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),cp=require('node:child_process');
const root=path.resolve(__dirname,'../../../..');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const read=p=>JSON.parse(fs.readFileSync(p,'utf8'));
const write=(name,data)=>fs.writeFileSync(path.join(__dirname,name),JSON.stringify(data,null,2));
const baseline=read(path.join(__dirname,'snapshots/baseline/manifest.json'));
const handoff=read(path.join(__dirname,'snapshots/handoff/manifest.json'));
const changed=handoff.records.filter(r=>r.sha256!==baseline.records.find(b=>b.owner===r.owner)?.sha256);
for(const r of handoff.records.filter(r=>r.sha256)) if(sha(fs.readFileSync(path.join(root,r.owner)))!==r.sha256) throw Error('Owner changed since handoff: '+r.owner);
write('changed-files.json',{head:handoff.head,branch:handoff.branch,product:changed.filter(r=>r.owner.includes('/src/')),test:changed.filter(r=>r.owner.includes('/e2e/')),documentation:['docs/full-ui-interaction-sweep/progress.md','docs/full-ui-interaction-sweep/visual-gap-register.md','docs/full-ui-interaction-sweep/frontend-series/20260915-autonomous-frontend/']});
fs.mkdirSync(path.join(__dirname,'diffs'),{recursive:true});
const empty=path.join(__dirname,'diffs/empty-before');fs.writeFileSync(empty,'');
for(const [label,a,b] of [['A','A-before','A-after'],['B','B-before','B-after'],['C','C-before','C-after'],['D','D-before','D-after'],['E','D-after','handoff'],['final','baseline','handoff']]) {
 let diff='';
 for(const {owner} of changed) {
  const before=path.join(__dirname,'snapshots',a,owner),after=path.join(__dirname,'snapshots',b,owner);
  if(!fs.existsSync(after))continue;
  const result=cp.spawnSync('git',['-c','core.autocrlf=false','diff','--no-index','--',fs.existsSync(before)?before:empty,after],{encoding:'utf8',maxBuffer:20*1024*1024});
  if(result.status>1)throw Error(result.stderr);
  diff+=result.stdout.replaceAll(path.join(__dirname,'snapshots',a).replaceAll('\\','/')+'/', '').replaceAll(path.join(__dirname,'snapshots',b).replaceAll('\\','/')+'/', '');
 }
 fs.writeFileSync(path.join(__dirname,'diffs',label+'.diff'),diff);
}
const reviews=read(path.join(__dirname,'reviews.json')),index=[],commands=[];
function buildFor(run){
 if(run.startsWith('A-before'))return 'index-CX-477i5.js';
 if(run.startsWith('A-')||run.startsWith('B-before'))return 'index--GltSaMt.js';
 if(run.startsWith('B-')||run.startsWith('C-before'))return 'index-5DxDyUlx.js';
 if(run==='D-before-01'||/^C-(after|contracts-0[12])/.test(run))return 'index-C21PqUmH.js';
 if(run.startsWith('D-')||run==='E-context-01')return 'index-9alf7tws.js';
 if(['E-final-production-01','E-filters-01','C-contracts-03'].includes(run))return 'index-7WW6V7iY.js';
 return 'index-CFsF6wa3.js';
}
for(const dir of fs.readdirSync(path.join(__dirname,'evidence'),{withFileTypes:true}).filter(d=>d.isDirectory())){
 const filename=path.join(__dirname,'evidence',dir.name,'runtime.json');if(!fs.existsSync(filename))continue;
 const runtime=read(filename);
 commands.push({run:dir.name,tests:runtime.records.filter(r=>r.test),unknown:runtime.unknown,errors:runtime.errors,interceptedMutationAttempts:runtime.network.filter(r=>r.method&&r.method!=='GET'),realBackendWrites:runtime.realBackendWrites,warning:dir.name==='E-final-production-02'?'Worker restarted; runtime is final segment. Full statuses in final-browser-02.log.':undefined});
 for(const r of runtime.records.filter(r=>r.file)){
  const relative=`evidence/${dir.name}/${r.file}`,buf=fs.readFileSync(path.join(__dirname,relative));
  if(sha(buf)!==r.sha256)throw Error('PNG changed: '+relative);
  const scope=`${dir.name}/${r.file}`;
  const transitional=/^(B-after|C-after|D-after|D-before)/.test(dir.name);
  index.push({...r,file:relative,phase:runtime.before?'before':'after',role:r.role||(/^B-after/.test(dir.name)?'TECH_MECHANIC':dir.name==='A-restricted-01'?'WORKER':'ADMIN'),roleSource:r.role?'capture':'reconstructed from fixed run harness',build:r.build||buildFor(dir.name),buildSource:r.build?'captured script URL':'recorded build/command sequence',sourceFingerprints:runtime.source,review:reviews[scope]||(transitional?'CAPTURED_TRANSITIONAL_OR_SUPERSEDED_NOT_LAYOUT_ACCEPTED':'CAPTURED_NOT_DIRECTLY_REVIEWED')});
 }
}
for(const key of Object.keys(reviews))if(!index.some(r=>r.file==='evidence/'+key))throw Error('Missing reviewed image '+key);
write('screenshot-index.json',index);
const columns=['file','phase','role','theme','viewport','state','build','time','sha256','review'];
fs.writeFileSync(path.join(__dirname,'screenshot-index.csv'),[columns.join(','),...index.map(r=>columns.map(k=>JSON.stringify(typeof r[k]==='object'?JSON.stringify(r[k]):String(r[k]??''))).join(','))].join('\n'));
write('command-results.json',commands);
const productDiff=changed.filter(r=>r.owner.includes('/src/'));
write('static-review.json',{productFiles:productDiff.length,changedOwners:productDiff.map(r=>r.owner),noBackendSchemaEnvUploadOwnerChanged:true,newRouterOrPopstateListener:false,resizeObserverCleanup:'disconnect',typeDelta:read(path.join(__dirname,'type-delta-final.json')).introduced,pngCount:index.length,directlyReviewed:index.filter(r=>r.review.startsWith('REVIEWED')).length,notes:['Counts are images/tests, not unique controls.','Synthetic harness credential constants are fixtures, not real secrets.','Original trace archives excluded; runtime contains no auth headers.']});
const entries=[];
function collect(dir){for(const f of fs.readdirSync(dir,{withFileTypes:true})){const absolute=path.join(dir,f.name),relative=path.relative(__dirname,absolute).replaceAll('\\','/');if(f.isDirectory()){if(f.name!=='traces')collect(absolute);continue;}if(!/\.(md|txt|json|csv|diff|tsx|ts|css|cjs|ps1|log|png)$/.test(f.name)||['package-files.json','zip-verification.json','runtime-handoff.json'].includes(f.name))continue;entries.push({path:relative,sha256:sha(fs.readFileSync(absolute)),bytes:fs.statSync(absolute).size});}}
collect(__dirname);
if(fs.existsSync(path.join(__dirname,'runtime-handoff.json'))){const b=fs.readFileSync(path.join(__dirname,'runtime-handoff.json'));entries.push({path:'runtime-handoff.json',sha256:sha(b),bytes:b.length});}
write('package-files.json',{createdAt:new Date().toISOString(),entries});
console.log(JSON.stringify({productFiles:productDiff.length,pngCount:index.length,reviewed:index.filter(r=>r.review.startsWith('REVIEWED')).length,files:entries.length,bytes:entries.reduce((n,e)=>n+e.bytes,0)},null,2));
