'use strict';
// Evidence-only finalization; never imports product, runs tests, or accesses working runtime.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),cp=require('node:child_process'),assert=require('node:assert/strict');
const here=__dirname,batch=path.resolve(here,'../..'),root=path.resolve(batch,'../../../..');
const rel=p=>path.relative(root,p).replaceAll('\\','/'),sha=b=>crypto.createHash('sha256').update(b).digest('hex');
function safe(p){const q=rel(p);assert.ok(!q.startsWith('..')&&!path.isAbsolute(q));assert.ok(!/(^|\/)(\.env[^/]*|uploads|\.git|node_modules|credentials|cookies[^/]*|storageState[^/]*|private)(\/|$)/i.test(q),'Excluded evidence path');for(let x=p;x!==root;x=path.dirname(x))assert.ok(!fs.lstatSync(x).isSymbolicLink(),'Reparse evidence');return p;}
const bytes=p=>fs.readFileSync(safe(p)),read=p=>JSON.parse(bytes(p).toString('utf8').replace(/^\uFEFF/,''));
const record=p=>{const b=bytes(p);return{path:rel(p),bytes:b.length,sha256:sha(b)};};
function put(name,data){const p=path.join(here,name);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,Buffer.isBuffer(data)||typeof data==='string'?data:JSON.stringify(data,null,2),{flag:'wx'});return record(p);}
for(const name of ['after','diffs','final-identities.json','environment-runtime-receipt.json','source-delta-manifest.json','changed-files.txt'])assert.ok(!fs.existsSync(path.join(here,name)),'Preserve previous output: '+name);
const base=read(path.join(here,'baseline.json')),observed=read(path.join(here,'final-runtime-observation.json'));
const processIdentity=read(path.join(here,'old-helper-identity.json')),vmProof=read(path.join(here,'vm-state-after.json')),viewer=read(path.join(here,'vmconnect-observation.json'));
const observer=read(path.join(here,'console-observer-terminal.json')),observerStart=read(path.join(here,'console-observer-start.json'));
const old=observed.processes.find(p=>p.pid===9056),newObserver=observed.processes.find(p=>p.pid===8296),newViewer=observed.processes.find(p=>p.pid===9616);
// A changed lifecycle requires a new factual checkpoint, not silently retaining a stale blocker.
assert.equal(old?.exists,true);assert.equal(old.start,'2026-09-20T08:26:22.4640876+03:00');assert.equal(processIdentity.commandLineVerified,true);
assert.equal(newObserver?.exists,false);assert.equal(newViewer?.exists,false);assert.equal(observed.oldTerminalExists,false);
assert.ok(observed.queue.filter(q=>q.name.endsWith('.result.json')).every(q=>!q.exists));
assert.equal(observed.oldControllerSha256,'4f22e068a0d5f20a68a8b2070e89646424dea17a5dc62f1ecf996814e5beec9e');
assert.equal(observer.status,'READ_ONLY_OBSERVER_COMPLETED_VM_UNCHANGED');assert.equal(observerStart.actualTokenElevated,true);
const qroot=path.join(root,'.r5-runtime/master-r5-ubuntu24/control');
for(const q of observed.queue){const p=path.join(qroot,q.name);assert.equal(fs.existsSync(p),q.exists,'Queue advanced after final observation');if(q.exists)assert.equal(sha(bytes(p)),q.sha256);}
const beforeMatrix=name=>read(path.join(root,base.before.find(x=>x.owner===rel(path.join(batch,name))).path));
const normalizeLive=x=>{x=structuredClone(x);delete x.currentContinuation;for(const g of x.gates)g.liveTestStack.status='REASON_ONLY';return x;};
assert.deepEqual(normalizeLive(beforeMatrix('live-gate-matrix.json')),normalizeLive(read(path.join(batch,'live-gate-matrix.json'))));
for(const name of ['journey-matrix.json','expected-actual.json']){const before=beforeMatrix(name),after=read(path.join(batch,name));for(const x of [before,after]){delete x.currentContinuation;if(name==='expected-actual.json')delete x.runtimeInstallFailureClass;}assert.deepEqual(before,after);}
const groups=base.groups.map(g=>({kind:g.kind,files:g.files.map(f=>{const r=record(path.join(root,f.owner));assert.equal(r.sha256,f.sha256,'Source/build/harness changed');return{owner:f.owner,expected:f.sha256,sha256:r.sha256,bytes:r.bytes,unchanged:true};})}));
const matrices=base.matrices.map(m=>{const r=record(path.join(root,m.owner));assert.equal(r.sha256,m.sha256);return{path:m.owner,sha256:r.sha256,unchanged:true};});
const priorZips=base.priorZips.map(z=>{assert.equal(sha(bytes(path.join(root,z.path))),z.sha256);return{...z,unchanged:true};});
for(const h of base.helperReferences)assert.equal(sha(bytes(path.join(root,h.owner))),h.sha256,'Old helper changed');
const historical=base.priorEntryRetention.map(h=>{const owner=rel(path.join(batch,h.name)),current=sha(bytes(path.join(root,owner))),saved=base.before.find(r=>r.owner===owner);if(current!==h.sha256)assert.equal(saved?.sha256,h.sha256,'Unattributed historical change');return{name:h.name,expected:h.sha256,currentSha256:current,preservedAs:current===h.sha256?'ORIGINAL_BYTES':saved.path};});
const rows=base.before.map(row=>{assert.equal(sha(bytes(path.join(root,row.path))),row.sha256);const b=bytes(path.join(root,row.owner)),after=put('after/'+row.owner,b);const diff=cp.spawnSync('git',['-c','safe.directory='+root,'diff','--no-index','--no-ext-diff','--',path.join(root,row.path),path.join(root,after.path)],{cwd:root,encoding:'utf8',windowsHide:true,maxBuffer:8*1024*1024});assert.ok([0,1].includes(diff.status));return{owner:row.owner,before:{path:row.path,bytes:row.bytes,sha256:row.sha256},after,changed:sha(b)!==row.sha256,diff:put('diffs/'+row.owner+'.diff',diff.stdout)};});
const git=args=>cp.execFileSync('git',['-c','safe.directory='+root,...args],{cwd:root,encoding:'utf8',windowsHide:true}).trim();
assert.equal(git(['branch','--show-current']),base.branch);assert.equal(git(['rev-parse','HEAD']),base.head);
put('final-identities.json',{at:new Date().toISOString(),kind:'EVIDENCE_BYTE_RETENTION_NOT_PRODUCT_TEST',branch:base.branch,head:base.head,groups,matrices,priorZips,historicalEntryRetention:historical,oldHelpersUnchanged:base.helperReferences,matrixSemantics:{gateOwnersRequirementsCasesUnchanged:true,journeyRowsUnchanged:true,expectedCaseSetsUnchanged:true},productFixes:0,newProductTests:0});
const runtime={
 at:new Date().toISOString(),observationAt:observed.at,status:'BLOCKED_OLD_HELPER_QUEUE_AND_CONSOLE_ACCESS',
 vmId:'99a158da-c247-422c-ae11-109485a92b1f',lastActualVmObservation:vmProof,currentVmState:'NOT_FRESHLY_OBSERVED_LAST_PROVEN_RUNNING',currentVmOffProven:false,
 coordinator:{...old,commandLineProof:'old-helper-identity.json',commandLineProofAt:processIdentity.at,scriptSha256:observed.oldControllerSha256,executionLine:'UNKNOWN'},
 shutdown:{request:'000006',status:'PENDING_EXECUTION_AND_COMPLETION_UNVERIFIED',result:null,associatedHyperVJobs:vmProof.jobs,emptyJobsDoesNotProveCancellation:true,force:false,turnOff:false},
 coordinatorExit:{request:'000007',status:'QUEUED_UNVERIFIED',result:null},oldTerminalExists:observed.oldTerminalExists,queue:observed.queue,
 observer:{pid:8296,actualTokenElevated:true,terminal:observer,processAbsent:true,consentedUacConsumed:true},viewer:{pid:9616,processAbsent:true,observation:viewer},
 newMutatingControllerStarted:false,conditionalControllerUacUsed:false,guestInputActions:0,guestInstall:'UNVERIFIED_NO_CONSOLE',guestTransfer:'NOT_RUN',canaryRoundTrip:'NOT_RUN',isolationProof:'NOT_RUN',appStack:'NOT_RUN',
 ownAppsDbFixtures:[],ownFixtureCleanup:'N_A_NONE_CREATED',workingRuntimeDataCleanup:'UNKNOWN_NOT_INSPECTED',workingDbAccessed:false,workingDataEnvUploadsChanged:false,
 freeDiskBytes:observed.freeDiskBytes,disMRepeated:false,hostRestartRequested:false,systemSettingsChangesThisContinuation:[],proxyStarted:false,forceOrKill:false,
 nativeCaptured:0,nativeViewed:0,accessibilityErrorRead:true,uiSkill:'computer-use: capture unsupported error retained, selected own viewer only, no terminal automation',
 userInputNeeded:['Last lines of verified old helper, without input/closing/Force','Manual native frame of only own VMConnect opened as administrator, no enhanced resources or guest input'],
 boundary:'Do not start installation or a second mutating controller until old queue and operation are safely reconciled; preserve VM and all evidence.'
};
put('environment-runtime-receipt.json',runtime);
const additions=[];function walk(dir){for(const x of fs.readdirSync(dir,{withFileTypes:true})){const p=path.join(dir,x.name);assert.ok(!x.isSymbolicLink());if(x.isDirectory())walk(p);else additions.push(record(p));}}walk(here);
put('source-delta-manifest.json',{at:new Date().toISOString(),scope:'ONLY_CURRENT_EXISTING_VM_OBSERVATION_CONTINUATION; inherited product/worktree changes not attributed',beforeBaseline:rel(path.join(here,'baseline.json')),existingOwners:rows,additionsAtCollection:additions,productFilesChanged:[],productFixes:0,testsExecuted:false,systemSettingsChanges:[],oldHelpersAndQueueUnchanged:true,priorZips,library:'NOT_WRITTEN_PERSISTENCE_PENDING'});
put('changed-files.txt',rows.filter(r=>r.changed).map(r=>'MODIFIED_DOC_OR_R5_CONTEXT '+r.owner).concat(additions.map(r=>'ADDED_OWN_OBSERVATION_EVIDENCE_OR_HELPER '+r.path),'Final delta/package manifest and receipt listed separately in package-manifest.json/package-receipt.json.','No product files changed; runtime VHDX/ISO/private/DB/uploads not packaged.').join('\n')+'\n');
console.log(JSON.stringify({status:runtime.status,productUnchanged:groups.map(g=>({kind:g.kind,count:g.files.length})),parentMatricesUnchanged:matrices.length,priorZipsUnchanged:priorZips.length,priorEntriesRetained:historical.length,docOwnersChanged:rows.filter(r=>r.changed).length,oldHelperPresent:old.exists,oldResultsAbsent:true,observerAndViewerAbsent:true,productCasesExecuted:0}));
