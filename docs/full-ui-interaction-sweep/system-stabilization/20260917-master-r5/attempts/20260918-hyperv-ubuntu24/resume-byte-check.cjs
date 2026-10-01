// Read only the prior explicit product/build/harness/matrix allowlist; never inspect working data.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const batch=path.resolve(__dirname,'../..'),root=path.resolve(batch,'../../../..');
const read=p=>JSON.parse(fs.readFileSync(p,'utf8').replace(/^\uFEFF/,''));
const hash=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
function allowed(p){
  const q=p.replaceAll('\\','/');
  if(/(^|\/)(\.env[^/]*|uploads|node_modules|\.git|storageState[^/]*)(\/|$)/i.test(q)||q.includes('..')||path.isAbsolute(q))throw Error('Not a clean source/evidence owner: '+q);
  return path.join(root,q);
}
const prior=read(path.join(batch,'final-identities.json'));
const groups=prior.comparisons.map(g=>({kind:g.kind,files:g.files.map(f=>({owner:f.owner,sha256:hash(allowed(f.owner)),expected:f.afterSha256}))}));
for(const g of groups)for(const f of g.files)f.unchanged=f.sha256===f.expected;
const matrices=prior.matrices.map(f=>({path:f.path,sha256:hash(allowed(f.path)),expected:f.afterSha256}));
for(const f of matrices)f.unchanged=f.sha256===f.expected;
const oldPackage=read(path.join(batch,'package-receipt.json'));
const priorZip={sha256:hash(path.join(batch,'zavod-master-r5-checkpoint.zip')),expected:oldPackage.sha256};
priorZip.unchanged=priorZip.sha256===priorZip.expected;
const result={at:new Date().toISOString(),scope:'Byte retention only; not tests/builds/runtime',groups,matrices,priorZip,productTestsRun:0,workingDbAccessed:false};
fs.writeFileSync(path.join(__dirname,'resume-byte-check.json'),JSON.stringify(result,null,2),{flag:'wx'});
const changed=groups.flatMap(g=>g.files).filter(f=>!f.unchanged);
console.log(JSON.stringify({at:result.at,groups:groups.map(g=>({kind:g.kind,count:g.files.length,changed:g.files.filter(f=>!f.unchanged).map(f=>f.owner)})),matricesUnchanged:matrices.filter(f=>f.unchanged).length,priorZipUnchanged:priorZip.unchanged}));
if(changed.length||matrices.some(f=>!f.unchanged)||!priorZip.unchanged)process.exitCode=1;
