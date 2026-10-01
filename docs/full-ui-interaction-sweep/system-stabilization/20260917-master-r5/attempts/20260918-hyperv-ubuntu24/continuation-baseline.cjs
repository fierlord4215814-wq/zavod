// Compare only saved R5 checkpoint identities. Never import application code or read working data.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),cp=require('node:child_process');
const attempt=__dirname,batch=path.resolve(attempt,'../..'),root=path.resolve(batch,'../../../..');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const read=p=>JSON.parse(fs.readFileSync(p,'utf8').replace(/^\uFEFF/,''));
const put=(p,b)=>{const dest=path.join(attempt,p);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,Buffer.isBuffer(b)||typeof b==='string'?b:JSON.stringify(b,null,2),{flag:'wx'});return{path:path.relative(root,dest).replaceAll('\\','/'),sha256:sha(fs.readFileSync(dest))};};
const prior=read(path.join(batch,'final-identities.json'));
const groups=prior.comparisons.map(g=>({kind:g.kind,declaredIdentity:g.declaredR4Identity,files:g.files.map(f=>{const bytes=fs.readFileSync(path.join(root,f.owner));return{owner:f.owner,before:f.afterSha256,current:sha(bytes),bytes:bytes.length,unchanged:sha(bytes)===f.afterSha256};})}));
const matrices=prior.matrices.map(f=>({...f,current:sha(fs.readFileSync(path.join(root,f.path))),unchanged:sha(fs.readFileSync(path.join(root,f.path)))===f.afterSha256}));
const oldPackage=read(path.join(batch,'package-receipt.json'));
const retained=oldPackage.readback.map(f=>({name:f.name,oldSha256:f.sha256,current:sha(fs.readFileSync(path.join(batch,f.name))),unchanged:sha(fs.readFileSync(path.join(batch,f.name)))===f.sha256}));
const docs=['README.md','docs/full-ui-interaction-sweep/progress.md','docs/full-ui-interaction-sweep/visual-gap-register.md',...['final-report.md','progress.md','environment-choice.md','execution-plan.md','resume-prompt.txt','INDEX.md','decision-queue.md','source-update-delta.md','remaining-live-and-physical.md'].map(p=>path.relative(root,path.join(batch,p)).replaceAll('\\','/'))];
const before=docs.map(owner=>({owner,...put('before/'+owner,fs.readFileSync(path.join(root,owner)))}));
const git=args=>cp.execFileSync('git',['-c','safe.directory='+root,...args],{cwd:root,encoding:'utf8',maxBuffer:8*1024*1024,windowsHide:true});
const dirty=put('dirty-before.txt',git(['status','--short','--untracked-files=normal']));
put('continuation-request.txt',fs.readFileSync('C:/Users/79164/.codex/attachments/08cd10ab-026f-40fc-91b4-6b73c35d386c/pasted-text.txt'));
const result={at:new Date().toISOString(),branch:git(['branch','--show-current']).trim(),head:git(['rev-parse','HEAD']).trim(),groups,matrices,retained,priorZip:{bytes:fs.statSync(oldPackage.path).size,sha256:sha(fs.readFileSync(oldPackage.path)),matches:sha(fs.readFileSync(oldPackage.path))===oldPackage.sha256},before,dirty,attemptBefore:'ABSENT_CONFIRMED_WITH_TEST_PATH',workingDbAccessed:false};
put('baseline.json',result);
console.log(JSON.stringify({branch:result.branch,changedProductBuildHarness:groups.flatMap(g=>g.files).filter(f=>!f.unchanged),changedMatrices:matrices.filter(f=>!f.unchanged),changedR5CheckpointEntries:retained.filter(f=>!f.unchanged),priorZipRetained:result.priorZip.matches,beforeDocs:before.length}));
