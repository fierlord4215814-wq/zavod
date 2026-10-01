// R2 evidence-only inventory/export support. Never starts product infrastructure.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),cp=require('node:child_process'),assert=require('node:assert/strict');
const dir=__dirname,root=path.resolve(dir,'../../../..'),final=path.join(dir,'G2'),prior=path.resolve(dir,'../20260915-maximum-integration');
const revision=process.argv[3]||'',outDir=revision?path.join(dir,revision):dir;assert.ok(!revision||revision==='handoff');
const sha=x=>crypto.createHash('sha256').update(x).digest('hex'),read=p=>JSON.parse(fs.readFileSync(p,'utf8').replace(/^\uFEFF/,'')),rel=p=>path.relative(root,p).replaceAll('\\','/');
const walk=p=>fs.existsSync(p)?fs.readdirSync(p,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(p,e.name)):[path.join(p,e.name)]):[];
const save=(name,value)=>{const target=path.join(outDir,name);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,typeof value==='string'?value:JSON.stringify(value,null,2),{flag:'wx'});};
const hash=p=>({path:rel(p),sha256:sha(fs.readFileSync(p)),bytes:fs.statSync(p).size});
const frozen=()=>{cp.execFileSync(process.execPath,[path.join(dir,'final-artifacts.cjs'),'check','G2']);return read(path.join(final,'final-product-identity.json'));};
const safe=owner=>{assert.ok(!path.isAbsolute(owner)&&!owner.split('/').includes('..'));assert.ok(!/(^|\/)(?:\.env(?:\.|$)|uploads|node_modules|storageState|cookies|credentials|\.git)(\/|\.|$)/i.test(owner),owner);};
const action=process.argv[2];
if(action==='results'){
 const identity=frozen(),expected=read(path.join(final,'final-expected-node-cases.json'));
 const node=[];
 for(const runId of ['G2-backend-contracts-01','G2-support-contracts-01']){
  const r=read(path.join(dir,'runs',runId,'result.json'));assert.equal(r.exitCode,0);assert.equal(r.productFingerprintAfter,identity.productFingerprint);
  const log=fs.readFileSync(path.join(dir,'runs',runId,'stdout-stderr.log'),'utf8');
  for(const match of log.matchAll(/^ok (\d+) - (.+)$/gm)){const e=expected.cases.find(c=>c.title===match[2].trim());assert.ok(e,match[2]);node.push({...e,status:'PASS',runId,tapCase:Number(match[1])});}
 }
 assert.equal(node.length,expected.cases.length);assert.equal(new Set(node.map(c=>c.id)).size,node.length);
 const browserExpected=read(path.join(final,'final-expected-browser-scenarios.json')).expected,browser=[];
 for(const group of ['base','profile','return','bridge']){
  const file=path.join(final,`browser-${group}${revision&&group==='bridge'?'-recheck':''}-results.json`),r=read(file);assert.equal(r.status,'passed');
  for(const c of r.results){assert.equal(c.status,'passed');assert.equal(c.retry,0);const e=browserExpected.find(e=>e.id===c.id);assert.ok(e&&e.title===c.title);browser.push({...c,runId:`G2-browser-${group}-${revision&&group==='bridge'?'02':'01'}`,report:rel(file)});}
 }
 assert.equal(browser.length,browserExpected.length);assert.equal(new Set(browser.map(c=>c.id)).size,browser.length);
 const runs=fs.readdirSync(path.join(dir,'runs')).map(id=>{const folder=path.join(dir,'runs',id),start=read(path.join(folder,'start.json')),p=path.join(folder,'result.json');return{runId:id,command:start.command,startedAt:start.startedAt,productFingerprint:start.identity?.productFingerprint,...(fs.existsSync(p)?read(p):{status:'INTERRUPTED_OR_NO_TERMINAL_UNVERIFIED'}),start:rel(path.join(folder,'start.json')),log:rel(path.join(folder,'stdout-stderr.log'))};});
 save('final-test-manifest.json',{at:new Date().toISOString(),productFingerprint:identity.productFingerprint,expectedNode:rel(path.join(final,'final-expected-node-cases.json')),expectedBrowser:rel(path.join(final,'final-expected-browser-scenarios.json')),counts:{backend:node.filter(x=>x.file.startsWith('backend/')).length,types:2,ws:3,browser:browser.length,fail:0,skipped:0},node,browser,runs,limits:['Tests are not unique controls or live acceptance.','G return MASTER intermittent failure remains unresolved even if final replay passes.','G2 supersedes source identity only; earlier raw/red/harness results remain retained.']});
 console.log(JSON.stringify({node:node.length,browser:browser.length,runs:runs.length}));
}else if(action==='delta'){
 const identity=frozen(),receipt=read(path.join(dir,'receipt.json'));
 const manifests=walk(path.join(dir,'snapshots')).filter(p=>path.basename(p)==='manifest.json').map(p=>({path:p,...read(p)})).sort((a,b)=>a.time.localeCompare(b.time));
 const records=manifests.flatMap(m=>m.records.map(r=>({...r,snapshot:rel(path.join(path.dirname(m.path),r.owner)),time:m.time})));
 const initial=new Map([...receipt.sources,...receipt.tests,...receipt.config].map(r=>[r.owner,r]));
 const owners=new Set([...identity.files.map(r=>r.owner),...records.map(r=>r.owner),...walk(path.join(root,'backend/scripts')).map(rel).filter(p=>/\/master-r2-/.test(p)),...walk(path.join(root,'frontend/scripts')).map(rel).filter(p=>/\/master-r2-/.test(p))]);
 const output=[];
 for(const owner of [...owners].sort()){
  if(owner.startsWith('docs/')||!fs.existsSync(path.join(root,owner)))continue;safe(owner);
  const current=hash(path.join(root,owner)),base=initial.get(owner),versions=records.filter(r=>r.owner===owner),absence=versions.find(r=>r.absent);
  if(base?.sha256===current.sha256)continue;
  const matching=base?versions.find(r=>r.sha256===base.sha256):null;
  let beforePath=matching?.snapshot||(!base&&!absence?versions.find(r=>!r.absent)?.snapshot:null),beforeStatus=base?'EXACT_INITIAL_HASH':absence?'ABSENT_BEFORE_CREATION':'INITIAL_INVENTORY_ABSENT_OR_EARLIEST_AVAILABLE';
  if(base&&!beforePath){const candidates=walk(path.join(prior,'source-snapshots')).filter(p=>p.replaceAll('\\','/').endsWith('/'+owner));beforePath=candidates.find(p=>sha(fs.readFileSync(p))===base.sha256);if(beforePath)beforePath=rel(beforePath);}
  if(base&&!beforePath)beforeStatus='INITIAL_HASH_ONLY_BEFORE_BYTES_NOT_FOUND';
  const afterName='source-after/'+owner;save(afterName,fs.readFileSync(path.join(root,owner)).toString('utf8'));
  let diffPath=null;
  if(beforePath){const old=path.join(root,beforePath),result=cp.spawnSync('git',['diff','--no-index','--no-ext-diff','--',old,path.join(root,owner)],{encoding:'utf8',maxBuffer:20*1024*1024,windowsHide:true});assert.ok([0,1].includes(result.status),result.stderr);diffPath='diffs/'+owner+'.diff';save(diffPath,result.stdout);}
  else if(absence||!base){diffPath='diffs/'+owner+'.diff';const lines=fs.readFileSync(path.join(root,owner),'utf8').split(/\r?\n/);save(diffPath,`--- /dev/null\n+++ ${owner}\n@@ -0,0 +1,${lines.length} @@\n`+lines.map(x=>'+'+x).join('\n'));}
  output.push({owner,kind:/^(backend|frontend)\/src\//.test(owner)?'product':/package(?:-lock)?\.json$|tsconfig/.test(owner)?'dependency-or-config':'test-or-support',beforeSha256:base?.sha256||null,beforeStatus,beforePath,absenceReceipt:absence||null,afterSha256:current.sha256,bytes:current.bytes,afterPath:rel(path.join(outDir,afterName)),diffPath:diffPath?rel(path.join(outDir,diffPath)):null,versions});
 }
 save('source-delta-manifest.json',{at:new Date().toISOString(),baselineProduct:receipt.productFingerprint,productFingerprint:identity.productFingerprint,owners:output,counts:output.reduce((a,r)=>(a[r.kind]=(a[r.kind]||0)+1,a),{}),lineage:'Only R2 differences; entire dirty git diff is not attributed to this run. New files lacking explicit initial ABSENT retain that gap.'});
 save('changed-files.md','# R2 changed files\n\nNot the entire dirty worktree. Complete hashes/before lineage: source-delta-manifest.json.\n\n'+output.map(x=>`- ${x.owner} — ${x.kind}; ${x.beforeStatus}`).join('\n')+'\n');
 const status=cp.execFileSync('git',['status','--short','--untracked-files=all'],{cwd:root,encoding:'utf8',maxBuffer:20*1024*1024});save('git-status-at-handoff.txt',status);console.log(JSON.stringify({owners:output.length,product:output.filter(x=>x.kind==='product').length,missingBefore:output.filter(x=>x.beforeStatus.includes('NOT_FOUND')).map(x=>x.owner)}));
}else if(action==='native-index'){
 const identity=frozen(),reviewed=read(path.join(dir,'native-reviewed.json')),all=[];
 for(const file of walk(path.join(dir,'evidence')).filter(p=>path.basename(p)==='runtime.json')){const run=read(file);for(const r of run.records||[])if(r.file?.endsWith('.png')){const p=path.join(path.dirname(file),r.file),entry=hash(p);assert.equal(entry.sha256,r.sha256);const nativeReview=reviewed.entries.find(x=>x.path===entry.path);const roleRecord=run.records.find(x=>x.variant&&x.role);all.push({...r,...entry,run:run.run,caseId:run.currentTest,rawCapturedRole:r.role,actualRole:roleRecord?.role||r.role,roleBasis:roleRecord?'actual per-case auth fixture override and recorded variant':'capture role / actual fixture',nativeReview:nativeReview||{status:'CAPTURED_NOT_REVIEWED'},finalTarget:['G2-browser-profile-01','G2-browser-return-01','G2-browser-bridge-02'].includes(run.run)});}}
 const targets=all.filter(r=>r.finalTarget);assert.equal(targets.length,78);assert.ok(targets.every(r=>r.nativeReview.status==='VIEWED'),targets.filter(r=>r.nativeReview.status!=='VIEWED').map(r=>r.path).join('\n'));
 save('native-evidence-index.json',{at:new Date().toISOString(),productFingerprint:identity.productFingerprint,finalTargetCount:targets.length,totalCaptured:all.length,priorPackagesUnchanged:true,entries:all});console.log(JSON.stringify({targets:targets.length,all:all.length}));
}else if(action==='matrices'){
 const identity=frozen(),cases=read(path.join(dir,'handoff/final-test-manifest.json')).node,census=read(path.join(dir,'replay-census-final.json'));
 const map={Chats:['master-r2-membership-future.test.js','membership'],Checklists:['master-r2-stock-replay.test.js','checklist'],Defrost:['master-r2-defrost-line-replay.test.js','Defrost'],Employee:['master-r2-related-replay.test.js','Employee'],ErrorReport:['master-r2-quality-replay.test.js','Report'],Line:['master-r2-defrost-line-replay.test.js','Line'],Okk:['master-r2-quality-replay.test.js','OKK'],Orders:['master-r2-stock-replay.test.js',''],Returns:['master-r2-quality-replay.test.js','Returns'],Shift:['master-r2-related-replay.test.js','Contractor'],Stock:['master-r2-quality-replay.test.js','Stock'],Task:['master-r2-replay.test.js','Task'],Wash:['master-r2-replay.test.js','Wash']};
 const exclusions={'LineService.assignPlannedSlot':'No stored entity return: current requested board target is returned, not resultKey. STATIC non-entity row; no vulnerability inferred.','LineService.applyPlanningTemplate':'No stored entity return: current board/read context, not resultKey. STATIC non-entity row.','ShiftService.activateCurrentLinePlan':'Internal maintenance presence-only check; no result entity response. Scheduler/bootstrap prohibited.','ShiftService.activateCurrentWorkAreaPlan':'Internal maintenance presence-only check; no result entity response. Scheduler/bootstrap prohibited.'};
 const rows=census.rows.map(r=>{const key=r.id.split('Service')[0],[file,pattern]=map[key];let witnesses=cases.filter(c=>c.file.endsWith(file)&&c.title.toLowerCase().includes(pattern.toLowerCase()));
  if(r.id.includes('FutureShift'))witnesses=cases.filter(c=>c.file.endsWith('master-r2-membership-future.test.js')&&/future/i.test(c.title));
  if(r.id==='OrdersService.createRequestTx')witnesses=cases.filter(c=>c.file.endsWith('master-r2-orders.test.js'));
  if(r.id.startsWith('ChecklistsService'))witnesses=cases.filter(c=>(c.file.endsWith('master-r2-stock-replay.test.js')&&/checklist/i.test(c.title))||(c.file.endsWith('master-r2-related-replay.test.js')&&/checklist/i.test(c.title)));
  const excluded=exclusions[r.id],resolver=['Okk','Returns','Stock','ErrorReport'].includes(key);
  return{...r,status:excluded?'STATIC_EXCLUDED_FROM_ENTITY_RESPONSE':resolver?'ACTUAL_RESOLVER_PROOF_CALLER_PARTIAL':'BOUNDED_METHOD_WITNESSES_NOT_ALL_BRANCHES',context:'Existing current user/capability guard + selected factory/object audience; no automatic factory switch',entity:resolver?'create result via existing findProcessedCreate':key,normalReadParity:'Current visible object required; do not reapply initial NEW/unoccupied state to completed result',witnesses:excluded?[]:witnesses.map(c=>({id:c.id,title:c.title,file:c.file,runId:c.runId,tapCase:c.tapCase})),limit:excluded||'Only named assertions in witness corpus; no blanket nested-edge, SQL, opaque kind/input or temporal-policy acceptance'};});
 save('replay-eligibility-matrix.json',{productFingerprint:identity.productFingerprint,denominator:45,unit:'AST methods incl callers/helpers, NOT endpoints/controls',rows,supplemental:[{id:'WashService.createRequest',store:'WashRequest direct userId_operationId, not ProcessedOperation census',proof:cases.filter(c=>c.file.endsWith('master-r2-replay.test.js')&&/request/i.test(c.title)).map(c=>c.id),limit:'Explicit supplemental direct-key store; denominator unchanged'}],open:['R2-REPLAY-KIND','R2-REPLAY-TIME','Actual HTTP/SQL boundaries']});
 const old=fs.readFileSync(path.join(prior,'integrated-journeys-matrix.md'),'utf8').split(/\r?\n/).filter(l=>/^\| J\d\d \|/.test(l)).map(l=>{const a=l.split('|').map(x=>x.trim());return{id:a[1],oldStatus:a[2],oldProof:a[3],oldLimit:a[4]};});assert.equal(old.length,32);
 const definitions=read(path.join(dir,'journey-delta-definitions.json'));
 const journeys=old.map(r=>{const d=definitions[r.id];return{...r,status:d?.status||r.oldStatus,delta:d||{summary:'Prior bounded contract retained and applicable baseline rerun in G2; no new module-wide claim',tests:'final-test-manifest node/browser prior cases',limit:r.oldLimit}};});
 save('integrated-journeys-matrix.json',{productFingerprint:identity.productFingerprint,count:32,unit:'journey definitions; not tests/controls',counts:journeys.reduce((a,r)=>(a[r.status]=(a[r.status]||0)+1,a),{}),journeys});
 save('integrated-journeys-matrix.md','# J01–J32 — R2 delta\n\n32 unchanged journey IDs. BOUNDED_ISOLATED means the named finite branch contract, never all product permutations/live acceptance. Prior rows/proof/limits retained in JSON; raw prior matrix unchanged.\n\n| ID | Previous → current | R2 source→receiver→reader / evidence | Residual |\n|---|---|---|---|\n'+journeys.map(r=>`| ${r.id} | ${r.oldStatus} → ${r.status} | ${r.delta.summary}; ${r.delta.tests} | ${r.delta.limit} |`).join('\n')+'\n');
 console.log(JSON.stringify({replay:rows.length,journeys:journeys.length,counts:journeys.reduce((a,r)=>(a[r.status]=(a[r.status]||0)+1,a),{})}));
}else if(action==='edges'){
 const identity=frozen(),old=read(path.join(prior,'semantic-edge-matrix-handoff.json')),defs=read(path.join(dir,'edge-proof-definitions.json'));
 const entries=defs.map(d=>{const e=old.edges.find(e=>e.id===d.id);assert.ok(e,d.id);const file=path.join(root,d.testFile),lines=fs.readFileSync(file,'utf8').split(/\r?\n/);const references=d.assertions.map(s=>{const line=lines.findIndex(l=>l.includes(s));assert.ok(line>=0,s);return{file:d.testFile,line:line+1,assertion:s};});return{...d,oldStatus:e.status,oldOwnerSha256:e.ownerSha256,owner:e.owner,source:e.source,target:e.target,contract:e.contract,bindings:e.bindings,sourceSha256:sha(fs.readFileSync(path.join(root,e.owner))),references};});
 assert.equal(old.edges.length,1407);save('affected-edge-proof.json',{productFingerprint:identity.productFingerprint,denominator:1407,unit:'existing semantic edges, NOT method families or tests',priorCounts:old.counts,entries,unchangedStaticAndPartialEdges:1407-entries.length,strictWholeEdgePromotion:0,reason:'Finite branch witnesses added; multi-binding edges and downstream adapter internals remain incomplete. No family-wide promotion or denominator reduction.',mappingCorrection:{id:'48fd254ff086c0479fc5',old:old.edges.find(e=>e.id==='48fd254ff086c0479fc5'),newContract:'POST /attachments/upload',reason:'apiClient.upload is multipart POST, not apiClient.get. Original binding/line retained; classification fix, not all upload consumers verified.'}});console.log(JSON.stringify({edges:entries.length,wholeEdgePromotion:0,denominator:1407}));
}else if(action==='safety'){
 const identity=frozen(),delta=read(path.join(dir,'handoff/source-delta-manifest.json')),findings=[],checks=[];
 for(const r of delta.owners.filter(r=>r.kind==='product')){const diff=fs.readFileSync(path.join(root,r.diffPath),'utf8'),added=diff.split(/\r?\n/).filter(l=>l.startsWith('+')&&!l.startsWith('+++'));
  for(const [name,re] of [['type-suppression',/@ts-ignore|@ts-nocheck/],['native-browser-dialog',/\b(?:window\.)?(?:alert|prompt|confirm)\s*\(/],['secret-value',/-----BEGIN .*PRIVATE KEY|(?:passwordHash|storagePath|JWT_SECRET)\s*[:=]/],['dynamic-code',/\beval\s*\(/]]){const hits=added.filter(l=>re.test(l));checks.push({owner:r.owner,check:name,addedLines:added.length,hits:hits.length});if(hits.length)findings.push({owner:r.owner,name,lines:hits});}}
 const prohibitedChanged=['backend/prisma/schema.prisma','frontend/src/App.tsx','frontend/src/navigation/mobile-back.ts'];for(const owner of prohibitedChanged){const before=read(path.join(dir,'receipt.json')).sources.find(r=>r.owner===owner);assert.equal(sha(fs.readFileSync(path.join(root,owner))),before.sha256,owner);}
 const scripts=delta.owners.filter(r=>r.kind==='test-or-support'&&/\.(?:cjs|js)$/.test(r.owner));const syntax=scripts.map(r=>{const c=cp.spawnSync(process.execPath,['--check',path.join(root,r.owner)],{encoding:'utf8',windowsHide:true});return{owner:r.owner,exitCode:c.status,stderr:c.stderr};});assert.ok(syntax.every(r=>r.exitCode===0));
 save('targeted-safety-scan.json',{productFingerprint:identity.productFingerprint,scope:'Added product diff lines only + changed JS/CJS syntax; not whole-system security audit',checks,findings,syntax,unchangedOwners:prohibitedChanged,runtimeGuards:'actual G2 controller/UserContext/PermissionGuard corpus; no DB/bootstrap/network boundary allowed',knownResiduals:['UI-SWEEP-063 intermittent exact scroll','014 provenance','050 legacy PILOT','replay kind/time and publication policy','live/physical']});console.log(JSON.stringify({productOwners:checks.length/4,findings:findings.length,syntax:scripts.length}));
}else if(action==='parent'){
 const old=read(path.join(prior,'receipt.json')),sweep=path.resolve(dir,'../..'),matrices=old.matrixHashes.map(r=>{const p=path.join(sweep,r.name),now=hash(p);assert.equal(now.sha256,r.sha256,r.name);return{...r,current:now,unchanged:true};});
 save('parent-matrix-retention.json',{at:new Date().toISOString(),main:'PAUSED_BY_USER / NOT_ACCEPTED',parent:old.parent,matrices,countsAreHistoricalNotReaccepted:true,denominatorChangedByR2:false});console.log(JSON.stringify({unchanged:matrices.length,controls:old.parent.controls,pass:old.parent.controlResults.PASS}));
}else if(action==='export-plan'||action==='root-export-plan'){
 frozen();const make=(name,files,base)=>({name,entries:[...new Set(files)].sort().map(p=>{const r=rel(p);safe(r);return{source:r,name:path.relative(base,p).replaceAll('\\','/'),...hash(p)};})});
 const docFiles=walk(dir).filter(p=>!/[\\/](?:evidence|snapshots|source-after|diffs|runs)[\\/]/.test(p)&&!/(?:\.zip|package-.*\.json|export-plan.*\.json)$/.test(p)&&!p.includes('git-status-at-handoff')&&/\.(?:md|json|txt|cjs|ps1)$/.test(p));
 let parts;
 if(action==='export-plan'){
  const baseline=read(path.join(dir,'receipt.json')),d=read(path.join(dir,'handoff/source-delta-manifest.json'));
  const support=[...baseline.tests.map(r=>path.join(root,r.owner)),...d.owners.filter(r=>r.kind!=='product').map(r=>path.join(root,r.owner))];
  parts=[make('review-sources-tests-logs.zip',[...walk(path.join(dir,'snapshots')),...walk(path.join(dir,'handoff/source-after')),...walk(path.join(dir,'handoff/diffs')),...walk(path.join(dir,'runs')),...support],root),make('review-native-evidence.zip',walk(path.join(dir,'evidence')),dir)];
 }else {
  parts=[make('master-r2-review.zip',[...docFiles,path.join(dir,'package-parts.json')],dir)];
  for(const r of read(path.join(dir,'parent-matrix-retention.json')).matrices)parts[0].entries.push({source:r.current.path,name:'parent-matrices/'+r.name,...r.current});
  for(const name of ['progress.md','visual-gap-register.md']){
   const p=path.resolve(dir,'../..',name),r=hash(p);
   parts[0].entries.push({source:rel(p),name:'parent-state/'+name,...r});
  }
 }
 for(const part of parts)for(const e of part.entries){assert.ok(!e.name.startsWith('../'),'Use explicit parent matrix copies for root export: '+e.name);if(/\.(?:ts|tsx|js|cjs|json|md|txt|log|diff|ps1)$/.test(e.source)){const content=fs.readFileSync(path.join(root,e.source),'utf8');assert.ok(!/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|Bearer eyJ[A-Za-z0-9_-]{30}/.test(content),'Possible secret, export stopped: '+e.source);}}
 save(action==='export-plan'?'export-plan-parts.json':'export-plan-root.json',{at:new Date().toISOString(),parts,exclusions:['.env and credentials','cookies/storageState','DB/uploads','node_modules/.git','old ZIP parts','whole dirty-worktree backup'],sourceSnapshotsAreNotBackup:true});console.log(JSON.stringify(parts.map(p=>({name:p.name,entries:p.entries.length,bytes:p.entries.reduce((n,e)=>n+e.bytes,0)}))));
}else throw Error('Unknown report action');
