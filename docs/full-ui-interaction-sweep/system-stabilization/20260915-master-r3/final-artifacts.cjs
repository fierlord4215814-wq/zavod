// Exact reuse of immutable R2 final recorder, with explicit R3 test census and baseline paths.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),Module=require('node:module'),assert=require('node:assert/strict');
const core=path.resolve(__dirname,'../20260915-master-r2/final-artifacts.cjs');let source=fs.readFileSync(core,'utf8');
assert.equal(crypto.createHash('sha256').update(source).digest('hex'),'0353b41ae69dc647e84aa8d5fb07a19045d65de79bdf5ddf8c92c5b60f1b093d');
for(const [from,to]of [
 ['/^master-r2-.*\\.test\\.js$/','/^master-r[23]-.*\\.test\\.js$/'],
 ["path.join(batch,'types/genuine-baseline.json')","path.join(batch,'../20260915-master-r2/types/genuine-baseline.json')"],
 ["?'R2-backend':","?'R2-R3-backend':"],
 ]){assert.ok(source.includes(from),from);source=source.replace(from,to);}
const inherited=new Module(path.join(__dirname,'inherited-r2-final.cjs'),module);inherited.filename=path.join(__dirname,'inherited-r2-final.cjs');inherited.paths=module.paths;inherited._compile(source,inherited.filename);
