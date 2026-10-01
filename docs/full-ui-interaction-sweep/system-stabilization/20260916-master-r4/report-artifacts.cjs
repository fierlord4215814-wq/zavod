// Reuse pinned R2 snapshots/diff/parent engine and helpers; R4 extension is evidence-only.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),Module=require('node:module'),assert=require('node:assert/strict');
const core=path.resolve(__dirname,'../20260915-master-r2/report-artifacts.cjs');let source=fs.readFileSync(core,'utf8');
assert.equal(crypto.createHash('sha256').update(source).digest('hex'),'eed4b4f8b50ffa20a9ab16846640b760bd9084b7f6797582121c8cfbea948de8');
if(process.argv[2]==='delta'){
 const replacements=[
  ["typeof value==='string'?value:JSON.stringify(value,null,2)","Buffer.isBuffer(value)||typeof value==='string'?value:JSON.stringify(value,null,2)"],
  ["[...receipt.sources,...receipt.tests,...receipt.config]","[...receipt.comparisons.find(r=>r.kind==='product').checks,...receipt.comparisons.find(r=>r.kind==='harness').checks.map(r=>({...r,owner:r.path})),...receipt.config]"],
  ["save(afterName,fs.readFileSync(path.join(root,owner)).toString('utf8'))","save(afterName,fs.readFileSync(path.join(root,owner)))"],
  ["if(owner.startsWith('docs/')||!fs.existsSync(path.join(root,owner)))continue;","if(owner.startsWith('docs/')||owner.replaceAll('\\\\','/').includes('/dist/')||!fs.existsSync(path.join(root,owner)))continue;"],
  ["['status','--short','--untracked-files=all']","['-c','safe.directory='+root,'status','--short','--untracked-files=normal']"],
 ];
 for(const [from,to]of replacements){assert.ok(source.includes(from),from);source=source.replace(from,to);}
 source=source.replace(/const owners=new Set\(.*\);/,"const owners=new Set([...identity.files.map(r=>r.owner),...records.map(r=>r.owner)]);");
 source=source.replaceAll('Only R2 differences','Only R4 differences').replaceAll('# R2 changed files','# R4 changed files');
}else if(process.argv[2]!=='parent'){
 const marker='const action=process.argv[2];';assert.ok(source.includes(marker));source=source.slice(0,source.indexOf(marker))+fs.readFileSync(path.join(__dirname,'r4-report-actions.cjs'),'utf8');
}
const inherited=new Module(path.join(__dirname,'inherited-r2-report.cjs'),module);inherited.filename=path.join(__dirname,'inherited-r2-report.cjs');inherited.paths=module.paths;inherited._compile(source,inherited.filename);
