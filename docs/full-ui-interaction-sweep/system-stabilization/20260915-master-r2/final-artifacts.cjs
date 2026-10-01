// Local evidence generator. No network, database, bootstrap or business mutations.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const batch=__dirname,pass=process.argv[3]||'',dir=pass?path.join(batch,pass):batch,root=path.resolve(batch,'../../../..'),prior=path.resolve(batch,'../20260915-maximum-integration');
assert.ok(!pass||/^G[2-9]$/.test(pass),'Only a new immutable final-pass subdirectory is allowed');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex'),read=f=>JSON.parse(fs.readFileSync(f,'utf8').replace(/^\uFEFF/,'')),rel=p=>path.relative(root,p).replaceAll('\\','/');
const walk=d=>fs.readdirSync(d,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(d,e.name)):[path.join(d,e.name)]);
const save=(n,value)=>{const p=path.join(dir,n);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,Buffer.isBuffer(value)||typeof value==='string'?value:JSON.stringify(value,null,2),{flag:'wx'});};
const hashFile=owner=>({owner,sha256:sha(fs.readFileSync(path.join(root,owner))),bytes:fs.statSync(path.join(root,owner)).size});
const sources=()=>[...walk(path.join(root,'frontend/src')),...walk(path.join(root,'frontend/public')),...walk(path.join(root,'backend/src')),path.join(root,'backend/prisma/schema.prisma')].map(rel).sort().map(hashFile);
const assertFreeze=()=>{const f=read(path.join(dir,'final-product-identity.json'));assert.equal(sha(JSON.stringify(sources())),f.productFingerprint,'Product bytes changed after freeze');return f;};
const baseline=['master-module-guards.test.js','master-offline-contract.test.js','master-stateful-chain.test.js','master-domain-contracts.test.js','master-provenance-contract.test.js','master-task-replay-boundary.test.js','ui-sweep-036-archive-contract.test.js'].map(n=>'backend/scripts/'+n);
const backend=[...baseline,...fs.readdirSync(path.join(root,'backend/scripts')).filter(n=>/^master-r2-.*\.test\.js$/.test(n)).map(n=>'backend/scripts/'+n)];
const support=['frontend/scripts/master-r2-type-contract.test.cjs','frontend/scripts/master-ws-contract.test.cjs'];
const action=process.argv[2];
if(action==='freeze'){
 const files=sources();save('final-product-identity.json',{at:new Date().toISOString(),productFingerprint:sha(JSON.stringify(files)),files,config:['frontend/package.json','frontend/tsconfig.json','backend/package.json','backend/tsconfig.build.json','backend/tsconfig.json','frontend/vite.config.ts','package-lock.json','package.json'].map(hashFile),baselineProduct:read(path.join(batch,'receipt.json')).productFingerprint,mainSweep:'PAUSED_BY_USER / NOT_ACCEPTED'});console.log(sha(JSON.stringify(files)));
}else if(action==='expected'){
 const frozen=assertFreeze();require(path.join(root,'backend/scripts/master-offline-guard.cjs'));const Module=require('node:module'),load=Module._load;let owner='';const cases=[];
 const test=(name,...args)=>{assert.equal(typeof name,'string');cases.push({file:owner,title:name,id:sha(owner+'\0'+name).slice(0,16),group:baseline.includes(owner)?'prior-backend':owner.startsWith('backend/')?'R2-backend':owner.includes('-ws-')?'prior-WS':'R2-types'});};test.test=test;test.after=()=>{};test.before=()=>{};test.beforeEach=()=>{};test.afterEach=()=>{};
 Module._load=function(request){return request==='node:test'?test:load.apply(this,arguments);};
 for(owner of [...backend,...support]){assert.ok(fs.existsSync(path.join(root,owner)),owner);require(path.join(root,owner));}
 Module._load=load;assert.equal(new Set(cases.map(c=>c.title)).size,cases.length,'Ambiguous result-title mapping');
 save('final-expected-node-cases.json',{at:new Date().toISOString(),productFingerprint:frozen.productFingerprint,registrationOnly:true,callbacksAndHooksExecuted:false,files:[...backend,...support].map(hashFile),cases,baselineFiles:baseline,backendFiles:backend,supportFiles:support,superseded:[],priorNegativeCasesRetained:true});console.log(JSON.stringify(cases.reduce((a,c)=>(a[c.group]=(a[c.group]||0)+1,a),{})));
}else if(action==='build-identity'){
 const frozen=assertFreeze(),files=[...walk(path.join(root,'frontend/dist')),...walk(path.join(root,'backend/dist'))].map(rel).sort().map(hashFile);save('final-build-identity.json',{at:new Date().toISOString(),productFingerprint:frozen.productFingerprint,files,buildFingerprint:sha(JSON.stringify(files)),commands:[`${pass||'G'}-backend-build-01`,`${pass||'G'}-frontend-build-01`]});console.log(JSON.stringify({files:files.length,fingerprint:sha(JSON.stringify(files))}));
}else if(action==='schema'){
 const cp=require('node:child_process'),schema=path.join(root,'backend/prisma/schema.prisma'),guard=path.join(root,'backend/scripts/master-offline-guard.cjs'),cli=path.join(root,'backend/node_modules/prisma/build/index.js');
 // Validate only, never db/migrate/generate. Synthetic URL preempts real DATABASE_URL;
 // JS network/Prisma construction blocked before CLI import, native installed validator only.
 const result=cp.spawnSync(process.execPath,['--require',guard,cli,'validate','--schema',schema],{cwd:dir,env:{...process.env,DATABASE_URL:'postgresql://r2_unused:r2_unused@127.0.0.1:1/r2_unused',CHECKPOINT_DISABLE:'1'},encoding:'utf8',windowsHide:true});
 console.log(result.stdout||'');console.error(result.stderr||'');save('schema-check.json',{schemaSha256:sha(fs.readFileSync(schema)),exitCode:result.status,signal:result.signal,mode:'installed prisma validate only; explicit unused synthetic URL, offline infrastructure preload; no DB or schema application',stdout:result.stdout,stderr:result.stderr});process.exitCode=result.status??1;
}else if(action==='types'){
 assertFreeze();const a=read(path.join(batch,'types/genuine-baseline.json')),b=read(path.join(dir,'types/final-current.json'));const before=new Set(a.diagnostics.map(d=>d.semanticKey)),after=new Set(b.diagnostics.map(d=>d.semanticKey));
 save('types/final-comparison.json',{baselineErrors:a.errors,currentErrors:b.errors,resolved:a.diagnostics.filter(d=>!after.has(d.semanticKey)),introduced:b.diagnostics.filter(d=>!before.has(d.semanticKey)),sameRootGraph:JSON.stringify(a.roots)===JSON.stringify(b.roots),sameFileGraph:JSON.stringify(a.sources.map(s=>s.file))===JSON.stringify(b.sources.map(s=>s.file)),baselineGraph:a.sources.length,currentGraph:b.sources.length,configUnchanged:a.configSha256===b.configSha256,compiler:b.compiler});console.log(JSON.stringify({baseline:a.errors,current:b.errors,roots:b.roots.length,graph:b.sources.length}));
}else if(action==='check')console.log(JSON.stringify({productFingerprint:assertFreeze().productFingerprint,unchanged:true}));
else throw Error('Unknown evidence action');
