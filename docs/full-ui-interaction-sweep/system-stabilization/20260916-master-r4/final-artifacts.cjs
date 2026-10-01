// Reuse pinned final identity/census engine. R4 adds client cases; no live bootstrap.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),Module=require('node:module'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../../../..');
if(process.argv[2]==='frontend-build'){
 // Explicit envDir=false prevents Vite from reading any working .env file.
 import('vite').then(({build})=>build({root:path.join(root,'frontend'),configFile:path.join(root,'frontend/vite.config.ts'),envDir:false})).catch(e=>{console.error(e);process.exitCode=1;});
}else if(process.argv[2]==='schema'){
 const cp=require('node:child_process'),dir=path.join(__dirname,'G2/prisma-offline');fs.mkdirSync(dir,{recursive:true});
 const original=fs.readFileSync(path.join(root,'backend/prisma/schema.prisma'));const schema=path.join(dir,'schema.prisma');
 fs.writeFileSync(schema,original,{flag:'wx'});fs.writeFileSync(path.join(dir,'package.json'),'{"private":true,"name":"r4-offline-schema-validation-only"}',{flag:'wx'});
 const env=Object.fromEntries(Object.entries(process.env).filter(([k])=>/^(SystemRoot|WINDIR|COMSPEC|PATH|PATHEXT|TEMP|TMP|USERPROFILE|LOCALAPPDATA|APPDATA|PROGRAMFILES|PROGRAMFILES\(X86\)|ProgramData)$/i.test(k)));
 const cli=path.join(root,'backend/node_modules/prisma/build/index.js');
 const r=cp.spawnSync(process.execPath,['--require',path.join(root,'backend/scripts/master-offline-guard.cjs'),'--require',path.join(__dirname,'no-env-read.cjs'),cli,'validate','--schema',schema],{cwd:dir,env:{...env,DATABASE_URL:'postgresql://127.0.0.1:1/r4_schema_validation',CHECKPOINT_DISABLE:'1'},encoding:'utf8',windowsHide:true});
 console.log(r.stdout||'');console.error(r.stderr||'');
 fs.writeFileSync(path.join(__dirname,'G2/schema-check.json'),JSON.stringify({at:new Date().toISOString(),schemaSha256:crypto.createHash('sha256').update(original).digest('hex'),exitCode:r.status,signal:r.signal,mode:'Byte-identical own schema copy; own cwd/package; no-env-read+offline infrastructure guards; validate only, no generate/db/apply',stdout:r.stdout,stderr:r.stderr},null,2),{flag:'wx'});process.exitCode=r.status??1;
}else{
 const core=path.resolve(__dirname,'../20260915-master-r2/final-artifacts.cjs');let source=fs.readFileSync(core,'utf8');
 assert.equal(crypto.createHash('sha256').update(source).digest('hex'),'0353b41ae69dc647e84aa8d5fb07a19045d65de79bdf5ddf8c92c5b60f1b093d');
 for(const [from,to]of [
  ['/^master-r2-.*\\.test\\.js$/','/^master-r[234]-.*\\.test\\.js$/'],
  ["path.join(batch,'types/genuine-baseline.json')","path.join(batch,'../20260915-master-r2/types/genuine-baseline.json')"],
  ["group:baseline.includes(owner)?","group:owner.endsWith('master-r4-connectivity.test.js')?'R4-client':baseline.includes(owner)?"],
  ["?'R2-backend':","?'R2-R3-backend':"],
 ]){assert.ok(source.includes(from),from);source=source.replace(from,to);}
 const inherited=new Module(path.join(__dirname,'inherited-r2-final.cjs'),module);inherited.filename=path.join(__dirname,'inherited-r2-final.cjs');inherited.paths=module.paths;inherited._compile(source,inherited.filename);
}
