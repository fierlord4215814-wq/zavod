// Preserve the reboot checkpoint before continuation; evidence only, no product imports or working-data access.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),cp=require('node:child_process');
const dir=__dirname,attempt=path.resolve(dir,'..'),batch=path.resolve(attempt,'../..'),root=path.resolve(batch,'../../../..');
const read=p=>JSON.parse(fs.readFileSync(p,'utf8').replace(/^\uFEFF/,''));
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const rel=p=>path.relative(root,p).replaceAll('\\','/');
function safe(owner){if(/(^|\/)(\.env[^/]*|uploads|node_modules|\.git|credentials|storageState[^/]*)(\/|$)/i.test(owner)||owner.includes('..')||path.isAbsolute(owner))throw Error('Excluded owner');return path.join(root,owner);}
function put(name,data){const p=path.join(dir,name);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,Buffer.isBuffer(data)||typeof data==='string'?data:JSON.stringify(data,null,2),{flag:'wx'});return{path:rel(p),bytes:fs.statSync(p).size,sha256:sha(fs.readFileSync(p))};}
const prior=read(path.join(attempt,'final-identities.json'));
const groups=prior.groups.map(g=>({kind:g.kind,files:g.files.map(f=>{const b=fs.readFileSync(safe(f.owner));return{owner:f.owner,expected:f.sha256,sha256:sha(b),unchanged:sha(b)===f.sha256};})}));
const matrices=prior.matrices.map(f=>({...f,now:sha(fs.readFileSync(safe(f.path)))}));
const pkg=read(path.join(attempt,'package-receipt.json'));
const packageBytes=fs.readFileSync(pkg.path);
const owners=read(path.join(attempt,'source-delta-manifest.json')).existingOwners.map(f=>f.owner);
const before=owners.map(owner=>({owner,...put('before/'+owner,fs.readFileSync(safe(owner)))}));
const retained=pkg.readback.map(f=>({name:f.name,expected:f.sha256,current:sha(fs.readFileSync(path.join(batch,f.name)))}));
if(groups.some(g=>g.files.some(f=>!f.unchanged))||matrices.some(f=>f.now!==f.sha256)||sha(packageBytes)!==pkg.sha256||retained.some(f=>f.current!==f.expected))throw Error('Checkpoint drift detected, preserve and inspect');
const git=args=>cp.execFileSync('git',['-c','safe.directory='+root,...args],{cwd:root,encoding:'utf8',windowsHide:true}).trim();
put('baseline.json',{at:new Date().toISOString(),branch:git(['branch','--show-current']),head:git(['rev-parse','HEAD']),groups,matrices,before,retained,priorPackage:{path:pkg.path,bytes:packageBytes.length,sha256:pkg.sha256,entries:retained.length,unchanged:true},productEdits:0,workingDbAccessed:false});
console.log(JSON.stringify({changedProductBuildHarness:0,matricesUnchanged:matrices.length,beforeDocs:before.length,priorPackageEntriesRetained:retained.length,priorZipUnchanged:true}));
