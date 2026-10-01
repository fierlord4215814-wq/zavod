// R2 artifact/run recorder: explicit commands, safe metadata, immutable before/after receipts.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),cp=require('node:child_process');
const dir=__dirname,root=path.resolve(dir,'../../../..'),prior=path.resolve(dir,'../20260915-maximum-integration');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex'),read=f=>JSON.parse(fs.readFileSync(f,'utf8').replace(/^\uFEFF/,''));
const walk=d=>fs.readdirSync(d,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(d,e.name)):[path.join(d,e.name)]);
const relative=f=>path.relative(root,f).replaceAll('\\','/');
const save=(n,v)=>{const p=path.join(dir,n);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,Buffer.isBuffer(v)||typeof v==='string'?v:JSON.stringify(v,null,2),{flag:'wx'});};
const record=owner=>({owner,sha256:sha(fs.readFileSync(path.join(root,owner))),bytes:fs.statSync(path.join(root,owner)).size});
const products=()=>[...walk(path.join(root,'frontend/src')),...walk(path.join(root,'frontend/public')),...walk(path.join(root,'backend/src')),path.join(root,'backend/prisma/schema.prisma')].map(relative).sort().map(record);
const configs=['frontend/package.json','frontend/tsconfig.json','frontend/vite.config.ts','backend/package.json','backend/tsconfig.build.json','backend/tsconfig.json','package-lock.json','package.json'];
function identity(){const sources=products(),tests=[...walk(path.join(root,'backend/scripts')),...walk(path.join(root,'frontend/e2e')),...walk(path.join(root,'frontend/scripts'))].filter(f=>/master|frontend-series|component-contracts|module-journeys|review-variants|ui-sweep-036-archive-contract|helpers[\\/]components/.test(f)).map(relative).sort().map(record);return {productFingerprint:sha(JSON.stringify(sources)),sources,tests,config:configs.filter(p=>fs.existsSync(path.join(root,p))).map(record)};}
const action=process.argv[2];
if(action==='receipt'){
 const id=identity(),old=read(path.join(prior,'final-product-identity.json')),build=read(path.join(prior,'final-build-identity.json'));
 const buildChecks=build.files.map(r=>({...r,currentSha256:sha(fs.readFileSync(path.join(root,r.owner)))}));
 const manifests=['final-report.md','decision-queue.md','root-result-matrix.md','integrated-journeys-matrix.md','remaining-live-and-physical.md','semantic-edge-matrix-handoff.json','final-test-manifest.json','source-delta-manifest.json','final-build-identity.json','H-backend-contracts-01.log'].map(n=>({name:n,sha256:sha(fs.readFileSync(path.join(prior,n)))}));
 const oldTests=read(path.join(prior,'source-delta-manifest.json')).records.filter(r=>!r.ownProductDelta).map(r=>({owner:r.owner,expected:r.afterSha256,current:record(r.owner).sha256}));
 save('receipt.json',{time:new Date().toISOString(),...id,previousProductFingerprint:old.productFingerprint,sameProduct:id.productFingerprint===old.productFingerprint,priorArtifactHashes:manifests,priorTestComparison:oldTests,compiledBaseline:{files:buildChecks.length,mismatches:buildChecks.filter(r=>r.sha256!==r.currentSha256)},mainSweep:'PAUSED_BY_USER / NOT_ACCEPTED',writerCheck:'Only calling repo task active in app inventory; pre-write hashes required against external editors',liveFixtureCleanup:'UNKNOWN'});
 console.log(JSON.stringify({productFingerprint:id.productFingerprint,sameProduct:id.productFingerprint===old.productFingerprint,sourceCount:id.sources.length,testCount:id.tests.length,compiledBuildMismatches:buildChecks.filter(r=>r.sha256!==r.currentSha256).length,testMismatches:oldTests.filter(r=>r.expected!==r.current).length}));
}else if(action==='snapshot'){
 const name=process.argv[3],owners=process.argv.slice(4);if(!/^[\w-]+$/.test(name)||!owners.length)throw Error('Explicit scoped snapshot required');
 const rows=owners.map(owner=>{if(owner.includes('..')||/(?:^|\/)(?:\.env|uploads|node_modules)(?:\/|$)/.test(owner)||path.isAbsolute(owner))throw Error('Unsafe snapshot owner');const p=path.join(root,owner);if(!fs.existsSync(p))return{owner,absent:true};const b=fs.readFileSync(p);save('snapshots/'+name+'/'+owner,b);return{owner,sha256:sha(b),bytes:b.length};});save('snapshots/'+name+'/manifest.json',{time:new Date().toISOString(),records:rows});console.log(JSON.stringify(rows));
}else if(action==='check'){
 const m=read(path.join(dir,'snapshots',process.argv[3],'manifest.json'));for(const r of m.records){const p=path.join(root,r.owner);if(r.absent?fs.existsSync(p):!fs.existsSync(p)||sha(fs.readFileSync(p))!==r.sha256)throw Error('Scoped writer conflict '+r.owner);}console.log('SCOPED_BYTES_UNCHANGED');
}else if(action==='run'){
 const [id,cwdArg,program,...args]=process.argv.slice(3);if(!/^[\w-]+$/.test(id)||program!=='node')throw Error('Explicit node run required');const cwd=path.resolve(root,cwdArg);if(cwd!==root&&!cwd.startsWith(root+path.sep))throw Error('Outside project');
 const env=process.env.R2_CHILD_ENV?JSON.parse(process.env.R2_CHILD_ENV):{};for(const k of Object.keys(env))if(!/^(MASTER_BATCH|FRONTEND_SERIES_RUN|FRONTEND_SERIES_PHASE|FRONTEND_SERIES_CAPTURE|MASTER_GUARD_REPORT|R2_\w+|NO_COLOR)$/.test(k))throw Error('Unapproved recorded env key '+k);
 const start={runId:id,startedAt:new Date().toISOString(),command:{program:process.execPath,args,cwd:relative(cwd)||'.',explicitEnvironment:env},identity:identity(),status:'RUNNING_UNVERIFIED'};save('runs/'+id+'/start.json',start);save('runs/'+id+'/stdout-stderr.log','');
 const log=path.join(dir,'runs',id,'stdout-stderr.log');const child=cp.spawn(process.execPath,args,{cwd,env:{...process.env,...env},windowsHide:true,shell:false,stdio:['ignore','pipe','pipe']});save('runs/'+id+'/pid.json',{pid:child.pid||null,startedAt:start.startedAt});
 child.stdout.on('data',b=>{fs.appendFileSync(log,b);process.stdout.write(b);});child.stderr.on('data',b=>{fs.appendFileSync(log,b);process.stderr.write(b);});let spawnError;
 child.on('error',e=>{spawnError={name:e.name,code:e.code,message:e.message};});child.on('close',(code,signal)=>{save('runs/'+id+'/result.json',{runId:id,finishedAt:new Date().toISOString(),exitCode:code,signal,spawnError,status:code===0?'TERMINAL_EXIT0':'TERMINAL_NONZERO',logSha256:sha(fs.readFileSync(log)),productFingerprintAfter:identity().productFingerprint});process.exitCode=Number.isInteger(code)?code:1;});
}else throw Error('Unknown artifact command');
