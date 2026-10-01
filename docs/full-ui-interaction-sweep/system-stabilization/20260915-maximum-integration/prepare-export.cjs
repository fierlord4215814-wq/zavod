// Artifact-only allowlist and hash plan. No subprocess, tests, network, or product writes.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const dir=__dirname,root=path.resolve(dir,'../../../..'),sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const read=n=>JSON.parse(fs.readFileSync(path.join(dir,n),'utf8').replace(/^\uFEFF/,''));
const walk=d=>fs.readdirSync(d,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(d,e.name)):[path.join(d,e.name)]);
const relative=f=>path.relative(dir,f).replaceAll('\\','/');
const save=(n,v)=>fs.writeFileSync(path.join(dir,n),JSON.stringify(v,null,2),{flag:'wx'});
const final=read('final-product-identity.json'),delta=read('source-delta-manifest.json'),excluded=[],securityFindings=[];
const parts=[{name:'review-sources-and-tests.zip',description:'All207 final product owners,17 current test/support owners, frozen config, exact stage snapshots/diffs; no build/dependency tree.',files:[]},{name:'review-native-evidence.zip',description:'Entire329 native PNG corpus plus per-test safe runtime/result records, including before/failed runs.',files:[]},{name:'review-reports-and-matrices.zip',description:'All saved stage/final logs and reports/inventories/type diagnostics plus unchanged historical parent matrices and current source supersession.',files:[]}];
const forbiddenName=/(?:^|\/)(?:\.env(?:\..*)?|storageState[^/]*|cookies?[^/]*|uploads|node_modules|\.git)(?:\/|$)|\.(?:db|sqlite|dump|bak|har|pfx|pem)$/i;
function add(part,source,entry,expected){
 const absolute=path.resolve(source);if(!absolute.startsWith(root+path.sep))throw Error('OUTSIDE_PROJECT '+entry);if(forbiddenName.test(entry))throw Error('FORBIDDEN_NAME '+entry);const bytes=fs.readFileSync(absolute),hash=sha(bytes);if(expected&&hash!==expected)throw Error('OWNER_CHANGED '+entry);
 if(!/\.(png|ico|mp3|wav|woff2?)$/i.test(entry)){const text=bytes.toString('utf8');const patterns={PRIVATE_KEY:/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,CREDENTIAL_URL:/(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?):\/\/[^:\s/]+:[^@\s]+@/,PROVIDER_TOKEN:/\b(?:sk-[A-Za-z0-9]{24,}|gh[pousr]_[A-Za-z0-9]{24,}|xox[baprs]-[A-Za-z0-9-]{20,})\b/};for(const [name,re] of Object.entries(patterns))if(re.test(text))securityFindings.push({entry,pattern:name});}
 parts[part].files.push({source:absolute,entry,sha256:hash,bytes:bytes.length});
}
for(const f of walk(dir)){const r=relative(f);if(/(?:^|\/)error-context\.md$/.test(r)){excluded.push({path:r,reason:'RAW_ERROR_CONTEXT_NOT_EXPORTED; native failure PNG and terminal logs retained'});continue;}if(/\.zip$/.test(r)||/^(package-(plan|manifest|verification)|INDEX)\./.test(r)){excluded.push({path:r,reason:'PACKAGE_CONTROL_OR_GENERATED_PART_NOT_RECURSIVELY_PACKED'});continue;}if(r.startsWith('evidence/')){if(!/\.png$|\/runtime\.json$|\/\.last-run\.json$/.test(r))throw Error('Unexpected evidence format '+r);add(1,f,r);}else if(/^(snapshots|diffs|schema-validation)\//.test(r))add(0,f,r);else add(2,f,r);}
for(const r of final.sources)add(0,path.join(root,r.owner),'current-source/'+r.owner,r.sha256);
for(const r of delta.records.filter(r=>!r.ownProductDelta))add(0,path.join(root,r.owner),'current-tests/'+r.owner,r.afterSha256);
for(const r of final.configuration)add(0,path.join(root,r.owner),'current-config/'+r.owner,r.sha256);
const parent=path.resolve(dir,'../..');
for(const name of ['progress.md','visual-gap-register.md','interaction-matrix.csv','surface-inventory.csv','back-matrix.csv','text-integrity-matrix.csv','coverage-checkpoint.json','surface-reconciliation.json','control-exclusions.json'])add(2,path.join(parent,name),'parent-current/'+name);
const pngCount=parts[1].files.filter(f=>f.entry.endsWith('.png')).length;if(pngCount!==329)throw Error('EVIDENCE_INCOMPLETE');
for(const p of parts){if(new Set(p.files.map(f=>f.entry)).size!==p.files.length)throw Error('DUPLICATE_ENTRY '+p.name);p.files.sort((a,b)=>a.entry.localeCompare(b.entry));p.totalBytes=p.files.reduce((s,r)=>s+r.bytes,0);}
if(securityFindings.length){save('package-security-block.json',{findings:securityFindings,valuesDisclosed:false});throw Error('SECRET_PATTERN_EXPORT_BLOCK: inspect scoped files without outputting values');}
const plan={productFingerprint:final.productFingerprint,createdAtUtc:new Date().toISOString(),parts,excluded,security:{highConfidenceCredentialPatterns:0,forbiddenEntries:0,noAuthHeadersOrStorageState:true,scope:'Explicit allowed source/config/test and known intercepted fixture evidence; pattern scan is not a universal secret detector.'},pngCount,rootFiles:['final-report.md','root-result-matrix.md','decision-queue.md','remaining-live-and-physical.md','source-update-delta.md','runtime-final.json']};save('package-plan.json',plan);
console.log(JSON.stringify({parts:parts.map(p=>({name:p.name,files:p.files.length,bytes:p.totalBytes})),pngCount,excluded:excluded.length,secretPatterns:0}));
