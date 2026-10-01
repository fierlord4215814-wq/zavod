// Evidence-only handoff for the named Hyper-V continuation. No product imports, DB, services or network.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),cp=require('node:child_process');
const attempt=__dirname,batch=path.resolve(attempt,'../..'),root=path.resolve(batch,'../../../..');
const rel=p=>path.relative(root,p).replaceAll('\\','/');
const read=p=>JSON.parse(fs.readFileSync(p,'utf8').replace(/^\uFEFF/,''));
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
function safe(p){
  const q=path.relative(root,p).replaceAll('\\','/');
  if(q.startsWith('..')||path.isAbsolute(q)||/(^|\/)(\.env[^/]*|uploads|\.git|node_modules|credentials|cookies[^/]*|storageState[^/]*)(\/|$)/i.test(q))throw Error('Excluded path: '+q);
  for(let x=p;x!==root;x=path.dirname(x))if(fs.lstatSync(x).isSymbolicLink())throw Error('Reparse path: '+q);
  return p;
}
function put(name,data){
  const p=path.join(attempt,name);fs.mkdirSync(path.dirname(p),{recursive:true});
  fs.writeFileSync(p,Buffer.isBuffer(data)||typeof data==='string'?data:JSON.stringify(data,null,2),{flag:'wx'});
  const b=fs.readFileSync(p);return{path:rel(p),bytes:b.length,sha256:sha(b)};
}
const phase=process.argv[2];
if(phase==='before-matrices'){
  const names=['live-gate-matrix.json','journey-matrix.json','expected-actual.json'];
  const prior=read(path.join(batch,'package-receipt.json'));
  const rows=names.map(name=>{
    const owner=rel(path.join(batch,name)),b=fs.readFileSync(safe(path.join(root,owner)));
    if(sha(b)!==prior.readback.find(x=>x.name===name).sha256)throw Error('Unexpected pre-edit change: '+owner);
    return{owner,...put('before/'+owner,b)};
  });
  put('matrix-before-manifest.json',{at:new Date().toISOString(),rows});
  console.log(JSON.stringify({phase,saved:rows.length,priorBytesVerified:true}));
}else if(phase==='final'){
  const base=read(path.join(attempt,'baseline.json'));
  const more=read(path.join(attempt,'matrix-before-manifest.json'));
  const rows=[...base.before,...more.rows].map(row=>{
    const before=fs.readFileSync(safe(path.join(root,row.path)));
    if(sha(before)!==row.sha256)throw Error('Before evidence changed: '+row.path);
    const afterBytes=fs.readFileSync(safe(path.join(root,row.owner)));
    const after=put('handoff/after/'+row.owner,afterBytes);
    const d=cp.spawnSync('git',['-c','safe.directory='+root,'diff','--no-index','--no-ext-diff','--',path.join(root,row.path),path.join(root,after.path)],{cwd:root,encoding:'utf8',windowsHide:true,maxBuffer:5*1024*1024});
    if(![0,1].includes(d.status))throw Error('Scoped document diff failed');
    return{owner:row.owner,before:{path:row.path,sha256:row.sha256,bytes:before.length},after,changed:sha(afterBytes)!==row.sha256,diff:put('handoff/diffs/'+row.owner+'.diff',d.stdout)};
  });
  const prior=read(path.join(batch,'final-identities.json'));
  const groups=prior.comparisons.map(g=>({kind:g.kind,declaredR4Identity:g.declaredR4Identity,files:g.files.map(f=>{const b=fs.readFileSync(safe(path.join(root,f.owner)));return{owner:f.owner,expected:f.afterSha256,sha256:sha(b),bytes:b.length,unchanged:sha(b)===f.afterSha256};})}));
  const matrices=prior.matrices.map(f=>({path:f.path,expected:f.afterSha256,sha256:sha(fs.readFileSync(safe(path.join(root,f.path))))}));
  for(const m of matrices)m.unchanged=m.sha256===m.expected;
  const matrixCopies=matrices.map(m=>({owner:m.path,...put('references/current-parent-matrices/'+m.path,fs.readFileSync(safe(path.join(root,m.path))))}));
  put('references/current-parent-matrices-manifest.json',{at:new Date().toISOString(),scope:'Exact retained parent matrices, no new execution or recount',rows:matrixCopies});
  const oldPackage=read(path.join(batch,'package-receipt.json'));
  const oldZip=fs.readFileSync(path.join(batch,'zavod-master-r5-checkpoint.zip'));
  const priorZip={bytes:oldZip.length,sha256:sha(oldZip),expected:oldPackage.sha256,unchanged:sha(oldZip)===oldPackage.sha256};
  if(groups.some(g=>g.files.some(f=>!f.unchanged))||matrices.some(m=>!m.unchanged)||!priorZip.unchanged)throw Error('Unexpected product/matrix/archive change; preserve and review');
  const initialHashes=new Map(base.retained.map(f=>[f.name,f.oldSha256]));
  const history=oldPackage.readback.map(f=>{
    const current=sha(fs.readFileSync(path.join(batch,f.name)));
    const row=rows.find(r=>r.owner===rel(path.join(batch,f.name)));
    if(current!==f.sha256&&(!row||row.before.sha256!==f.sha256))throw Error('Unattributed historical change: '+f.name);
    return{name:f.name,atContinuationStart:initialHashes.get(f.name),oldSha256:f.sha256,currentSha256:current,preservedAs:current===f.sha256?'ORIGINAL_BYTES':row.before.path};
  });
  const git=args=>cp.execFileSync('git',['-c','safe.directory='+root,...args],{cwd:root,encoding:'utf8',windowsHide:true}).trim();
  put('final-identities.json',{at:new Date().toISOString(),scope:'BYTE_RETENTION_NOT_BUILD_TEST_OR_LINUX_RUNTIME',branch:git(['branch','--show-current']),head:git(['rev-parse','HEAD']),groups,matrices,priorZip,historicalEntryRetention:history,newProductFixes:0,newNodeBrowserLiveCases:0});
  const install=read(path.join(attempt,'native-dism-01/result.json')),request=read(path.join(attempt,'native-dism-01/request.json'));
  const log=fs.readFileSync(path.join(attempt,'native-dism-01/dism.log'),'utf8');
  if(install.exitCode!==3010||install.actualTokenElevated!==true||install.unexpectedFeatures.length||!log.includes('Reboot required=yes')||!log.includes('Restart suppressed by /NoRestart'))throw Error('Actual reboot proof mismatch');
  const runtime={at:new Date().toISOString(),status:'WAITING_MANUAL_REBOOT_NOT_LIVE_ACCEPTANCE',installerResultAt:install.at,caller:{session:19189,exitCode:0},installer:{pid:install.pid,exitCode:install.exitCode,actualTokenElevated:install.actualTokenElevated,command:request.executable+' '+request.arguments,coordinatorSha256:request.coordinatorSha256,changedFeatures:install.changedFeatures,unexpectedFeatures:install.unexpectedFeatures,completed:true},beforeBoot:request.lastBootUpTime,hypervisorPresent:install.afterHypervisor.HypervisorPresent,freeDiskBytes:install.freeDiskBytes,freeRamBytesBeforeInstall:request.freeRamBytes,restartRequirement:'REQUIRED_EXACT_EXIT_3010_AND_DISM_LOG',automaticHostReboot:false,executionPolicyChanged:false,vmCreated:false,isoDownloaded:false,guestIdentity:null,transferRoundTrip:'NOT_RUN',isolationProof:'NOT_RUN_NO_GUEST',appStack:'NOT_RUN',ownAppProcesses:[],syntheticFixtures:[],databases:[],ownCleanup:'N_A_NONE_CREATED',workingRuntimeAndCleanup:'UNKNOWN_NOT_INSPECTED',workingDbAccessed:false,workingDataEnvUploadsChanged:false,evidence:['native-dism-01/request.json','native-dism-01/process-start.json','native-dism-01/result.json','native-dism-01/dism.log']};
  put('environment-runtime-receipt.json',runtime);
  const additions=[];
  function walk(dir){for(const x of fs.readdirSync(dir,{withFileTypes:true})){const p=path.join(dir,x.name);if(x.isSymbolicLink())throw Error('Unexpected reparse');if(x.isDirectory())walk(p);else additions.push({path:rel(p),bytes:fs.statSync(p).size});}}
  walk(attempt);
  const self=rel(path.join(attempt,'source-delta-manifest.json'));
  put('source-delta-manifest.json',{at:new Date().toISOString(),baseline:'Named attempt ABSENT on 2026-09-18; snapshots before current edits',existingOwners:rows,additionsAtCollection:additions,selfManifest:self,newProductFiles:[],newProductFixes:0,productTestsExecuted:false,hostSystemChange:'Seven recorded Hyper-V optional features enabled through actual elevated DISM; reboot pending',priorZip,library:'NOT_WRITTEN_PERSISTENCE_PENDING'});
  put('changed-files.txt',rows.filter(r=>r.changed).map(r=>'MODIFIED_DOC_OR_MATRIX '+r.owner).concat(additions.map(r=>'ADDED_EVIDENCE_OR_HELPER '+r.path),'ADDED_EVIDENCE_OR_HELPER '+self,'Manifest/package artifacts created next are enumerated by package-manifest.json and package-receipt.json.').join('\n')+'\n');
  console.log(JSON.stringify({phase,existingChanged:rows.filter(r=>r.changed).length,productChanged:0,matricesUnchanged:matrices.length,priorEntriesRetained:history.length,priorZipUnchanged:priorZip.unchanged,installerExit:install.exitCode,actualTokenElevated:true,newLiveCases:0}));
}else throw Error('Use before-matrices or final; neither runs product/runtime');
