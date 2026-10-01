'use strict';
// Same-R5 continuation baseline; evidence-only copies, no product execution or protected runtime access.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict'),cp=require('node:child_process');
const here=__dirname,batch=path.resolve(here,'../..'),root=path.resolve(batch,'../../../..'),prior=path.join(batch,'attempts/20260920-vm-control');
const rel=p=>path.relative(root,p).replaceAll('\\','/'),sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const read=p=>JSON.parse(fs.readFileSync(p,'utf8').replace(/^\uFEFF/,''));
function put(name,b){const p=path.join(here,name);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,Buffer.isBuffer(b)||typeof b==='string'?b:JSON.stringify(b,null,2),{flag:'wx'});return{path:rel(p),bytes:fs.statSync(p).size,sha256:sha(fs.readFileSync(p))};}
assert.ok(!fs.existsSync(path.join(here,'baseline.json')),'Baseline exists; never rerun');
const identity=read(path.join(prior,'final-identities.json')),delta=read(path.join(prior,'source-delta-manifest.json')),receipt=read(path.join(prior,'package-receipt.json'));
const before=delta.existingOwners.map(r=>{const b=fs.readFileSync(path.join(root,r.owner));assert.equal(sha(b),r.after.sha256,'Unexpected report change');return{owner:r.owner,...put('before/'+r.owner,b)};});
const groups=identity.groups.map(g=>({kind:g.kind,files:g.files.map(f=>{const b=fs.readFileSync(path.join(root,f.owner));assert.equal(sha(b),f.sha256,'Unexpected frozen source/build/harness drift');return{owner:f.owner,bytes:b.length,sha256:sha(b)};})}));
const matrices=identity.matrices.map(m=>{const b=fs.readFileSync(path.join(root,m.path));assert.equal(sha(b),m.sha256);return{owner:m.path,...put('references/parent-matrices/'+m.path,b)};});
const helperReferences=['observe-vm-console.ps1','start-console-observer.ps1','vm-control.ps1'].map(name=>{const p=path.join(prior,name),b=fs.readFileSync(p);return{owner:rel(p),...put('references/prior-helpers/'+name,b)};});
const zips=[...identity.priorZips,{path:rel(receipt.path),sha256:receipt.sha256,bytes:receipt.bytes,entries:receipt.entries}].map(z=>{const b=fs.readFileSync(path.join(root,z.path));assert.equal(sha(b),z.sha256);return{...z,unchanged:true};});
const retained=receipt.readback.map(r=>{const p=path.join(batch,r.name),b=fs.readFileSync(p);assert.equal(sha(b),r.sha256,'Previous ZIP entry owner drift: '+r.name);return{name:r.name,bytes:b.length,sha256:r.sha256};});
const request=put('continuation-request.txt',fs.readFileSync('C:/Users/79164/.codex/attachments/ef597b09-5205-4468-9c23-9ae932803d3f/Вставленный текст.txt'));
const git=args=>cp.execFileSync('git',['-c','safe.directory='+root,...args],{cwd:root,encoding:'utf8',windowsHide:true}).trim();
put('baseline.json',{at:new Date().toISOString(),branch:git(['branch','--show-current']),head:git(['rev-parse','HEAD']),before,groups,matrices,helperReferences,priorZips:zips,priorEntryRetention:retained,userRequest:request,productExecution:false,workingDbAccessed:false});
console.log(JSON.stringify({before:before.length,groups:groups.map(g=>({kind:g.kind,count:g.files.length})),matrices:matrices.length,priorZips:zips.length,priorEntries:retained.length,helpers:helperReferences}));
