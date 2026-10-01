const fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
const root=path.resolve(__dirname,'../../../..');
const prior=path.join(root,'docs/full-ui-interaction-sweep/frontend-series/20260915-autonomous-frontend/snapshots/handoff');
const crypto=require('node:crypto'),sha=data=>crypto.createHash('sha256').update(data).digest('hex');
const receipt=new Map(JSON.parse(fs.readFileSync(path.join(__dirname,'baseline-product-hashes.json'),'utf8')).map(r=>[r.owner,r]));
const override=new Map();
for(const dir of fs.readdirSync(path.join(__dirname,'snapshots'))){const parent=path.join(__dirname,'snapshots',dir);const manifest=JSON.parse(fs.readFileSync(path.join(parent,'manifest.json'),'utf8'));for(const record of manifest.records)if(receipt.get(record.owner)?.sha256===record.sha256)override.set(record.owner,path.join(parent,record.owner));}
for(const record of JSON.parse(fs.readFileSync(path.join(prior,'manifest.json'),'utf8')).records)if(receipt.get(record.owner)?.sha256===record.sha256)override.set(record.owner,path.join(prior,record.owner));
const options={noEmit:true,jsx:ts.JsxEmit.React,target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,moduleResolution:ts.ModuleResolutionKind.Bundler,esModuleInterop:true,skipLibCheck:true,lib:['lib.es2022.d.ts','lib.dom.d.ts'],types:['vite/client']};
function check(baseline,entry){const host=ts.createCompilerHost(options),read=host.readFile,exists=host.fileExists;
 const relative=file=>path.relative(root,path.resolve(file)).replaceAll('\\','/');
 host.fileExists=file=>baseline&&relative(file).startsWith('frontend/src/')&&!receipt.has(relative(file))?false:exists(file);
 host.readFile=file=>{const owner=relative(file);if(!baseline||!owner.startsWith('frontend/src/'))return read(file);if(!receipt.has(owner))return undefined;const saved=override.get(owner);const value=fs.readFileSync(saved||file,'utf8');if(sha(value)!==receipt.get(owner).sha256)throw Error('Baseline bytes unavailable/conflicting: '+owner);return value;};
 const p=ts.createProgram([path.join(root,entry)],options,host);return {files:p.getSourceFiles().map(f=>relative(f.fileName)),diagnostics:ts.getPreEmitDiagnostics(p).map(d=>({file:d.file?relative(d.file.fileName):'',code:d.code,message:ts.flattenDiagnosticMessageText(d.messageText,' ')}))};}
const baseline=check(true,'frontend/src/App.tsx'),current=check(false,'frontend/src/App.tsx'),entry=check(false,'frontend/src/main.tsx');
const remaining=baseline.diagnostics.map(d=>JSON.stringify(d)),introduced=[];for(const d of current.diagnostics){const i=remaining.indexOf(JSON.stringify(d));if(i<0)introduced.push(d);else remaining.splice(i,1);}
const result={time:new Date().toISOString(),typescript:ts.version,options,configurationStatus:'NO_FRONTEND_TSCONFIG; @types/react and @types/react-dom absent in lockfile and resolution. No package installed. Supplemental virtual check is NOT full valid React type acceptance.',baseline,current,mainEntry:entry,introduced,resolved:remaining.map(d=>JSON.parse(d))};
fs.writeFileSync(path.join(__dirname,process.argv[2]||'typecheck.json'),JSON.stringify(result,null,2),{flag:'wx'});console.log(JSON.stringify({baseline:baseline.diagnostics.length,current:current.diagnostics.length,mainEntry:entry.diagnostics.length,introduced,resolved:result.resolved},null,2));process.exitCode=introduced.length?1:0;
