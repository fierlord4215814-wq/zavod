// Reuse R2 own-delta/parent retention writer, not a second snapshot/diff engine.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),Module=require('node:module'),assert=require('node:assert/strict');
const core=path.resolve(__dirname,'../20260915-master-r2/report-artifacts.cjs');let source=fs.readFileSync(core,'utf8');
assert.equal(crypto.createHash('sha256').update(source).digest('hex'),'eed4b4f8b50ffa20a9ab16846640b760bd9084b7f6797582121c8cfbea948de8');
source=source.replaceAll('/\\/master-r2-/','/\\/master-r[23]-/');
if(!['delta','parent'].includes(process.argv[2])){
 const marker="const action=process.argv[2];";assert.ok(source.includes(marker));
 source=source.slice(0,source.indexOf(marker))+fs.readFileSync(path.join(__dirname,'r3-report-actions.cjs'),'utf8');
}
const inherited=new Module(path.join(__dirname,'inherited-r2-report.cjs'),module);inherited.filename=path.join(__dirname,'inherited-r2-report.cjs');inherited.paths=module.paths;inherited._compile(source,inherited.filename);
