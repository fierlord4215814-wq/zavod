const o=require('./own.cjs'),{fs,path,root,sha,assert,receipt}=o;
const previous=require('../task-notify-01/source-checks.json');
const owners=[...previous.files.map(f=>f.path),...previous.newTests.map(f=>f.path),
 'backend/src/modules/orders/orders.service.ts','backend/src/modules/orders/orders.controller.ts',
 'backend/scripts/master-r2-orders.test.js','backend/src/common/permission.guard.ts',
 'backend/src/common/audit.service.ts','docs/vps-preparation/factory-01/stand.ps1',
 'docs/vps-preparation/task-notify-01/report.md'];
assert(!fs.existsSync(path.join(__dirname,'before.json')),'Immutable baseline already exists');
const files=[...new Set(owners)].map(f=>{const bytes=fs.readFileSync(path.join(root,f)),dest=path.join(__dirname,'before',f);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.copyFileSync(path.join(root,f),dest,fs.constants.COPYFILE_EXCL);return{path:f,bytes:bytes.length,sha256:sha(bytes)};});
for(const f of previous.files)assert.equal(files.find(x=>x.path===f.path).sha256,f.after,'Previous accepted owner changed: '+f.path);
const migrations=fs.readdirSync(path.join(root,'backend/prisma/migrations')).filter(n=>fs.existsSync(path.join(root,'backend/prisma/migrations',n,'migration.sql'))).sort().map(name=>({name,sha256:sha(fs.readFileSync(path.join(root,'backend/prisma/migrations',name,'migration.sql')))}));assert.equal(migrations.length,57);
const retainedZips=['factory-01','task-notify-01'].map(dir=>{const r=require('../'+dir+'/review-pack-readback.json'),bytes=fs.readFileSync(path.join(root,r.zip));assert.equal(sha(bytes),r.sha256);assert.equal(bytes.length,r.bytes);return{path:r.zip,bytes:bytes.length,sha256:r.sha256};});
receipt('before',{atUtc:new Date().toISOString(),sourceIdentity:sha(Buffer.from(JSON.stringify(files))),files,migrations,retainedZips,priorAcceptedProductHashesMatch:true,priorReportLocalInsertionPreserved:true});console.log('PASS new scoped baseline / accepted product hashes / 57 / retained ZIPs');
