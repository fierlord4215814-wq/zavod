// Scoped immutable artifacts, reusing the preceding batch's snapshot/diff convention.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const cp = require('node:child_process');
const ts = require('typescript');
const root = path.resolve(__dirname, '../../../..');
const prior = path.join(root, 'docs/full-ui-interaction-sweep/frontend-series/20260915-autonomous-frontend');
const sha = data => crypto.createHash('sha256').update(data).digest('hex');
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
const relative = file => path.relative(root, file).replaceAll('\\', '/');
function save(name, value) {
  const file = path.join(__dirname, name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2), { flag: 'wx' });
}
function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(dir,e.name)) : [path.join(dir,e.name)]);
}
function identity() {
  return [...walk(path.join(root,'frontend/src')), ...walk(path.join(root,'frontend/public')), ...walk(path.join(root,'backend/src')), path.join(root,'backend/prisma/schema.prisma')]
    .sort().map(file=>({owner:relative(file),bytes:fs.statSync(file).size,sha256:sha(fs.readFileSync(file))}));
}
function csv(file) {
  const rows=[]; let row=[],cell='',quoted=false;
  const text=fs.readFileSync(file,'utf8').replace(/^\uFEFF/,'');
  for(let i=0;i<text.length;i++) {const c=text[i]; if(c==='"'){if(quoted&&text[i+1]==='"'){cell+='"';i++;}else quoted=!quoted;}else if(c===','&&!quoted){row.push(cell);cell='';}else if(c==='\n'&&!quoted){row.push(cell.replace(/\r$/,''));rows.push(row);row=[];cell='';}else cell+=c;}
  if(cell||row.length){row.push(cell.replace(/\r$/,''));rows.push(row);}
  const headers=rows.shift();return rows.filter(r=>r.length>1).map(r=>Object.fromEntries(headers.map((h,i)=>[h,r[i]??''])));
}
const counts=(rows,key)=>rows.reduce((a,r)=>(a[r[key]]=(a[r[key]]||0)+1,a),{});
const action=process.argv[2];
if(action==='receipt') {
  const manifest=readJson(path.join(prior,'snapshots/handoff/manifest.json'));
  const compare=manifest.records.map(r=>({...r,current:sha(fs.readFileSync(path.join(root,r.owner))),matches:sha(fs.readFileSync(path.join(root,r.owner)))===r.sha256}));
  const evidence=readJson(path.join(prior,'screenshot-index.json'));
  const parent=path.join(root,'docs/full-ui-interaction-sweep');
  const controls=csv(path.join(parent,'interaction-matrix.csv'));
  const surfaces=csv(path.join(parent,'surface-inventory.csv'));
  const back=csv(path.join(parent,'back-matrix.csv')),text=csv(path.join(parent,'text-integrity-matrix.csv'));
  const seen=new Map();
  const reconciled=controls.map((r,i)=>{const key=[r.source,r.type,r.control,r.expected].join('|'); const ordinal=(seen.get(key)||0)+1;seen.set(key,ordinal);return {row:i+1,legacyId:r.controlId,semanticKey:sha(key).slice(0,16)+':'+ordinal,source:r.source,control:r.control,expected:r.expected,historicalResult:r.result,historicalEvidence:r.evidence,currentProof:'NOT_PROMOTED_BY_RECEIPT'};});
  save('source-control-reconciliation.json',reconciled);
  const files=identity();save('baseline-product-hashes.json',files);
  save('receipt.json',{time:new Date().toISOString(),head:cp.execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),priorZip:sha(fs.readFileSync(path.join(prior,'frontend-series-review.zip'))),priorOwnerComparison:compare,priorScreenshotIndexShape:Array.isArray(evidence)?'array':Object.keys(evidence),parent:{controls:controls.length,legacyUniqueIds:new Set(controls.map(r=>r.controlId)).size,semanticKeys:new Set(reconciled.map(r=>r.semanticKey)).size,controlResults:counts(controls,'result'),surfaceRows:surfaces.length,surfaceTested:counts(surfaces,'tested'),surfaceReachability:counts(surfaces,'reachable'),back:counts(back,'result'),text:counts(text,'runtimeScan'),exclusions:readJson(path.join(parent,'control-exclusions.json'))},productFingerprint:sha(JSON.stringify(files)),matrixHashes:['interaction-matrix.csv','surface-inventory.csv','back-matrix.csv','text-integrity-matrix.csv','coverage-checkpoint.json','surface-reconciliation.json'].map(name=>({name,sha256:sha(fs.readFileSync(path.join(parent,name)))}))});
  console.log(JSON.stringify({owners:compare.map(r=>({owner:r.owner,matches:r.matches})),controls:controls.length,legacyUniqueIds:new Set(controls.map(r=>r.controlId)).size,results:counts(controls,'result'),surfaces:surfaces.length,back:counts(back,'result'),text:counts(text,'runtimeScan'),fingerprintedOwners:files.length},null,2));
} else if(action==='snapshot') {
  const name=process.argv[3],owners=process.argv.slice(4); if(!name||!owners.length||!/^[\w-]+$/.test(name))throw Error('Name and scoped owners required');
  const dir=path.join(__dirname,'snapshots',name);if(fs.existsSync(dir))throw Error('Existing snapshot preserved');
  const records=owners.map(owner=>{if(!/^(frontend|backend)\/(src|public|e2e|scripts)\//.test(owner)||owner.includes('..')||/\.env|storageState|uploads/.test(owner))throw Error('Not a scoped source/test owner: '+owner);const file=path.join(root,owner);if(!fs.existsSync(file))return {owner,absent:true}; const data=fs.readFileSync(file);fs.mkdirSync(path.dirname(path.join(dir,owner)),{recursive:true});fs.writeFileSync(path.join(dir,owner),data,{flag:'wx'});return {owner,bytes:data.length,sha256:sha(data)};});
  save('snapshots/'+name+'/manifest.json',{time:new Date().toISOString(),records});console.log(JSON.stringify(records,null,2));
} else if(action==='check') {
  const manifest=readJson(path.join(__dirname,'snapshots',process.argv[3],'manifest.json'));
  for(const r of manifest.records){const f=path.join(root,r.owner);if(r.absent?fs.existsSync(f):!fs.existsSync(f)||sha(fs.readFileSync(f))!==r.sha256)throw Error('Writer conflict or own changed bytes: '+r.owner);}
  console.log('Scoped fingerprint unchanged');
} else if(action==='graph') {
  const sources=identity().filter(r=>/\.(tsx?|js)$/.test(r.owner));const nodes=[];
  for(const record of sources){const file=path.join(root,record.owner),s=fs.readFileSync(file,'utf8'),ast=ts.createSourceFile(file,s,ts.ScriptTarget.Latest,true); const imports=[],calls=[],events=[],modals=[];
    function visit(n){const line=ast.getLineAndCharacterOfPosition(n.getStart()).line+1;
      if(ts.isImportDeclaration(n)&&ts.isStringLiteral(n.moduleSpecifier))imports.push({specifier:n.moduleSpecifier.text,line});
      if(ts.isCallExpression(n)){const fn=n.expression.getText(ast);if(/apiClient\.|\.emit$|\.publish$|dispatchEvent$|fetch$/.test(fn))calls.push({fn,args:n.arguments.map(a=>a.getText(ast).slice(0,420)),line});}
      if(ts.isJsxOpeningElement(n)||ts.isJsxSelfClosingElement(n)){if(n.tagName.getText(ast)==='ActionModal')modals.push({line,attributes:n.attributes.getText(ast)});}
      ts.forEachChild(n,visit);
    }visit(ast);nodes.push({...record,imports,calls,modals});
  }
  save('source-graph.json',nodes);console.log(JSON.stringify({sourceFiles:nodes.length,imports:nodes.reduce((n,r)=>n+r.imports.length,0),calls:nodes.reduce((n,r)=>n+r.calls.length,0),ActionModalInstances:nodes.reduce((n,r)=>n+r.modals.length,0)},null,2));
} else throw Error('Unknown action');
