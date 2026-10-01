'use strict';
// Only pure command construction and synthetic host-side filesystem fixtures.
// Does not invoke create-seed-media.ps1, commands 0-2, or any VM/guest/product code.
const fs=require('node:fs'), path=require('node:path'), cp=require('node:child_process'), assert=require('node:assert/strict'), crypto=require('node:crypto');
const here=__dirname;
const runName=process.argv[2];
assert(runName && /^run-[a-z0-9-]+$/.test(runName),'Specify a new named evidence run; never overwrite prior results');
const out=path.join(here,runName);fs.mkdirSync(out); // create-new only
const pwsh='C:/Users/79164/.cache/codex-runtimes/codex-primary-runtime/dependencies/native/powershell/pwsh.exe';
const sh='C:/Users/79164/.cache/codex-runtimes/codex-primary-runtime/dependencies/native/git/usr/bin/sh.exe';
const yaml=require('C:/Users/79164/Documents/work/.r5-runtime/provisioning-checks-yaml-2.8.1/package/dist/index.js');
const put=(n,v)=>fs.writeFileSync(path.join(out,n),typeof v==='string'?v:JSON.stringify(v,null,2),{flag:'wx'});
const env={...process.env,PATH:path.dirname(sh)+';'+process.env.PATH};
for(const n of ['BASH_ENV','ENV','SHELLOPTS','BASHOPTS'])delete env[n];
const run=(exe,args)=>{const p=cp.spawnSync(exe,args,{cwd:here,encoding:'utf8',windowsHide:true,timeout:8000,maxBuffer:1024*1024,env});return{exe,args,exitCode:p.status,signal:p.signal,error:p.error?.message??null,stdout:p.stdout??'',stderr:p.stderr??''};};
const rows=[];
function check(id,fn){let detail;try{detail=fn();rows.push({id,status:detail?.blocked?'BLOCKED_ENV_PREREQUISITE':'PASS',detail});}catch(e){rows.push({id,status:'FAIL',error:e.stack});}put('generator-'+String(rows.length).padStart(2,'0')+'.json',rows.at(-1));}
const emit=run(pwsh,['-NoProfile','-File',path.join(here,'emit-command-fixture.ps1')]);
put('generator-emitter-raw.json',emit);assert.equal(emit.exitCode,0,'Pure emitter failed');
const fixture=JSON.parse(emit.stdout),commands=fixture.config.autoinstall['late-commands'];
put('fake-command-config.json',fixture);
const attached=JSON.parse(fs.readFileSync(path.join(here,'actual-seed-redacted.json'),'utf8'));
check('argv-json-yaml-roundtrip',()=>{
 assert.equal(commands.length,4);assert.deepEqual(commands.map(x=>x.length),[9,9,3,3]);
 for(let i=0;i<commands.length;i++){assert.equal(fixture.types[i].count,commands[i].length);for(let j=0;j<commands[i].length;j++){assert.equal(typeof commands[i][j],'string');assert.equal(fixture.types[i].argv[j].type,'System.String');assert.equal(fixture.types[i].argv[j].value,commands[i][j]);}}
 const cloudConfig='#cloud-config\n'+JSON.stringify(fixture.config,null,2)+'\n';
 const parsed=yaml.parse(cloudConfig),serialized=yaml.stringify(parsed);
 assert.deepEqual(parsed,fixture.config);assert.deepEqual(yaml.parse(serialized),fixture.config);
 put('fake-cloud-config.json-yaml.txt',cloudConfig);put('fake-cloud-config.roundtrip.yaml',serialized);
 return{counts:[9,9,3,3],allArgTypes:'string',parser:'yaml@2.8.1',jsonRoundTrip:true,yamlRoundTrip:true};
});
check('commands-0-through-2-unchanged',()=>{assert.deepEqual(commands.slice(0,3),attached.lateCommands.slice(0,3));return{comparedTo:'actual attached seed redacted readback',commandsExecuted:false};});
check('legacy-syntax-exit2',()=>{assert.equal(fixture.legacyArgv.length,5);const r=run(sh,['-n',...fixture.legacyArgv.slice(1)]);put('legacy-shell-raw.json',r);assert.equal(r.exitCode,2);assert.match(r.stderr,/unexpected EOF|unterminated/i);return{argumentCount:5,exitCode:r.exitCode,parseOnly:true};});
check('fixed-syntax-exit0',()=>{const r=run(sh,['-n',...commands[3].slice(1)]);put('fixed-shell-parse-raw.json',r);assert.equal(r.exitCode,0);return{argumentCount:3,exitCode:0,parseOnly:true};});
check('invalid-vmid-rejected',()=>{const r=run(pwsh,['-NoProfile','-File',path.join(here,'emit-command-fixture.ps1'),'-VmId','invalid"; printf forbidden']);put('invalid-vmid-raw.json',r);assert.notEqual(r.exitCode,0);assert.equal(r.stdout.trim(),'');return{exitCode:r.exitCode,validation:'UUID whitelist',programExecuted:false};});
const installPrerequisite=run(sh,['-c','command -v install']);put('install-prerequisite.json',installPrerequisite);
const installAvailable=installPrerequisite.exitCode===0 && installPrerequisite.stdout.trim().length>0;
const fixtureRoot=fs.mkdtempSync(path.join(out,'synthetic-target-'));
const posix=p=>p.replaceAll('\\','/').replace(/^([A-Za-z]):\//,(_,d)=>'/'+d.toLowerCase()+'/');
const quote=s=>"'"+s.replaceAll("'","'\"'\"'")+"'";
const marker='R5_NEW_OWN_16G_DISK_ONLY\n';
function functional(id,mode){
 // Missing install is an ENV prerequisite, not an expected copy/write denial.
 if(!installAvailable && !['missing-proof','wrong-proof'].includes(mode))return {blocked:true,reason:'HOST_GIT_RUNTIME_HAS_NO_INSTALL_UTILITY',functionalGuestCheck:'PENDING',guestTouched:false};
 const root=path.join(fixtureRoot,id),input=path.join(root,'run with space',"proof's input"),target=path.join(root,"target with ' quote"),copy=path.join(target,'var/log/r5-new-disk-proof'),instance=path.join(target,'etc/r5-provision-instance');
 fs.mkdirSync(path.dirname(input),{recursive:true});fs.mkdirSync(path.join(target,'etc'),{recursive:true});
 if(mode!=='missing-copy-parent')fs.mkdirSync(path.dirname(copy),{recursive:true});
 if(mode!=='missing-proof')fs.writeFileSync(input,mode==='wrong-proof'?'WRONG_SYNTHETIC_PROOF\n':marker,{flag:'wx'});
 if(mode==='blocked-marker')fs.mkdirSync(instance);
 let program=commands[3][2];
 for(const [from,to]of [['/run/r5-new-disk-proof',input],['/target/var/log/r5-new-disk-proof',copy],['/target/etc/r5-provision-instance',instance]]){assert(program.includes(from));program=program.split(from).join(quote(posix(to)));}
 assert(!program.includes('/target/'));assert(!program.includes('/run/r5-new-disk-proof'));
 const r=run(sh,['-c',program]);put(id+'-raw.json',r);
 if(mode==='good'){
  assert.equal(r.exitCode,0);assert.equal(fs.readFileSync(copy,'utf8'),marker);assert.equal(fs.readFileSync(instance,'utf8'),fixture.vmId+'\n');
  const repeat=run(sh,['-c',program]);put(id+'-repeat-raw.json',repeat);assert.equal(repeat.exitCode,0);assert.equal(fs.readFileSync(copy,'utf8'),marker);assert.equal(fs.readFileSync(instance,'utf8'),fixture.vmId+'\n');
 }else{
  assert.notEqual(r.exitCode,0);assert.notEqual(r.exitCode,127,'Missing utility is not the expected negative outcome');assert.equal(r.error,null);
  if(mode==='blocked-marker'){assert(fs.statSync(instance).isDirectory());assert.equal(fs.readFileSync(copy,'utf8'),marker);}
  else{assert(!fs.existsSync(instance));assert(!fs.existsSync(copy));}
 }
 return{exitCode:r.exitCode,fixtureRoot:root,proofCopied:fs.existsSync(copy),instanceFileWritten:fs.existsSync(instance)&&fs.statSync(instance).isFile(),syntheticOnly:true,modeProof:'Windows MSYS does not prove Ubuntu uid/gid/mode',targetQuoting:'spaces and apostrophe',existingGuestTouched:false};
}
check('synthetic-success-and-repeat',()=>functional('success','good'));
check('missing-proof-no-fabrication-no-marker',()=>functional('missing-proof','missing-proof'));
check('wrong-proof-rejected-no-marker',()=>functional('wrong-proof','wrong-proof'));
check('copy-failure-stops-before-marker',()=>functional('copy-failure','missing-copy-parent'));
check('marker-write-failure-is-nonzero-partial-copy-recorded',()=>functional('marker-failure','blocked-marker'));
const sha=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
for(const row of rows){if(row.detail?.blocked)row.status='BLOCKED_ENV_PREREQUISITE';}
const generator=path.join(here,'../20260920-vm-control/create-seed-media.ps1'),pure=path.join(here,'../20260920-vm-control/r5-late-commands.ps1');
const result={at:new Date().toISOString(),kind:'PROVISIONING_GENERATOR_ONLY_NOT_PRODUCT_GATE',status:rows.every(r=>r.status==='PASS')?'PASS_HOST_SYNTHETIC_GUEST_PENDING':rows.some(r=>r.status==='FAIL')?'FAIL':'SOURCE_VERIFIED_FUNCTIONAL_PENDING',cases:rows.length,passed:rows.filter(r=>r.status==='PASS').length,failed:rows.filter(r=>r.status==='FAIL').length,blocked:rows.filter(r=>r.status==='BLOCKED_ENV_PREREQUISITE').length,results:rows,powershell:fixture.powershellVersion,shell:sh,shellIdentity:'Host Git Bash in sh mode, not guest dash',generatorSha256:sha(generator),pureHelperSha256:sha(pure),fullMediaGeneratorExecuted:false,existingSeedRegenerated:false,guestRepairExecuted:false,guestPosixAndPermissionsVerification:'PENDING',sourceCorrectionApplied:true,workingDbAccessed:false};
put('generator-results.json',result);console.log(JSON.stringify({status:result.status,cases:result.cases,passed:result.passed,failed:result.failed,blocked:result.blocked,sourceCorrectionApplied:true,guestRepairExecuted:false,fixtureRoot}));
if(result.failed)process.exitCode=1;else if(result.blocked)process.exitCode=2;
