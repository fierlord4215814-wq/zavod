const fs=require('node:fs');
const path=require('node:path');
const ts=require('typescript');
const root=path.resolve(__dirname,'../../../..');
const baseline=path.join(__dirname,'snapshots/baseline');
const options={noEmit:true,jsx:ts.JsxEmit.React,target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,moduleResolution:ts.ModuleResolutionKind.Bundler,esModuleInterop:true,skipLibCheck:true,lib:['lib.es2022.d.ts','lib.dom.d.ts'],types:['vite/client']};
function check(useBaseline) {
 const host=ts.createCompilerHost(options),read=host.readFile;
 host.readFile=file=>{
  const relative=path.relative(root,path.resolve(file));
  const saved=path.join(baseline,relative);
  return useBaseline&&relative.startsWith('frontend'+path.sep+'src'+path.sep)&&fs.existsSync(saved)?fs.readFileSync(saved,'utf8'):read(file);
 };
 const program=ts.createProgram([path.join(root,'frontend/src/App.tsx')],options,host);
 return ts.getPreEmitDiagnostics(program).map(d=>({file:d.file?path.relative(root,d.file.fileName).replaceAll('\\','/'):'',code:d.code,message:ts.flattenDiagnosticMessageText(d.messageText,' ')}));
}
const before=check(true),after=check(false),key=d=>JSON.stringify(d);
const remaining=before.map(key),introduced=[];
for(const diagnostic of after){const index=remaining.indexOf(key(diagnostic));if(index<0)introduced.push(diagnostic);else remaining.splice(index,1);}
const result={beforeCount:before.length,afterCount:after.length,introduced,before,after};
fs.writeFileSync(path.join(__dirname,process.argv[2]||'type-delta.json'),JSON.stringify(result,null,2));
console.log(JSON.stringify({beforeCount:before.length,afterCount:after.length,introduced},null,2));
process.exitCode=introduced.length?1:0;
