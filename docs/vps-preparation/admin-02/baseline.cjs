'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict'),{execFileSync}=require('node:child_process');
const {ownPrisma,verifyOwnDb}=require('../local-02/own-db.cjs');
const root=path.resolve(__dirname,'../../..'),sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const files=[
 'backend/src/modules/employee/employee.service.ts','backend/src/modules/assignment/assignment.controller.ts',
 'backend/src/modules/shift/shift.service.ts','backend/src/modules/shift/shift.controller.ts',
 'backend/src/common/shift-attendance.ts','backend/src/common/shift-session.ts','backend/src/common/shift-time.ts',
 'backend/src/common/operation-lock.ts','backend/src/common/assignment-eligibility.ts','backend/src/common/user-context.service.ts',
 'backend/src/common/user-context.middleware.ts','backend/src/common/effective-permissions.ts','backend/src/common/permission.guard.ts',
 'backend/src/common/permissions.ts','backend/src/common/audit.service.ts','backend/src/common/audit-presentation.ts',
 'backend/src/shift/employee-state.policy.ts','backend/src/modules/people/assignment-close.ts','backend/src/modules/people/people.service.ts',
 'backend/src/modules/line/line.service.ts','backend/src/modules/wash/wash.service.ts',
 'backend/src/modules/notifications/notifications.service.ts',
 'backend/src/modules/shift-log/shift-log.service.ts','backend/src/modules/shift-log/shift-log.controller.ts','backend/src/modules/shift-log/shift-log.module.ts',
 'backend/src/modules/attachments/attachments.service.ts','backend/src/ws/events.ts','backend/src/ws/ws.service.ts',
 'frontend/src/ws/client.ts','frontend/src/screens/ShiftPeopleScreen.tsx','frontend/src/screens/ShiftLogScreen.tsx',
 'frontend/src/screens/AdminConfigScreen.tsx','frontend/src/navigation/permissions.ts',
 'backend/src/modules/admin/admin.service.ts','backend/prisma/schema.prisma','backend/prisma/system-foundation.cjs',
];
(async()=>{
 assert(!fs.existsSync(path.join(__dirname,'before.json')),'Preserve baseline');
 const prior=JSON.parse(fs.readFileSync(path.join(__dirname,'../admin-01/final-integrity.json'),'utf8'));
 for(const f of prior.files) assert.equal(sha(fs.readFileSync(path.join(root,f.path))),f.after,`ADMIN01 source changed: ${f.path}`);
 const snapshots=files.map(relative=>{const bytes=fs.readFileSync(path.join(root,relative));const dest=path.join(__dirname,'before',relative);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,bytes);return{path:relative,sha256:sha(bytes),bytes:bytes.length};});
 const migrations=fs.readdirSync(path.join(root,'backend/prisma/migrations'),{withFileTypes:true}).filter(x=>x.isDirectory()).map(x=>({name:x.name,sha256:sha(fs.readFileSync(path.join(root,'backend/prisma/migrations',x.name,'migration.sql')))})).sort((a,b)=>a.name.localeCompare(b.name));assert.equal(migrations.length,57);
 const p=ownPrisma();try{const identity=await verifyOwnDb(p);const counts={users:await p.user.count(),activeAccesses:await p.userFactoryAccess.count({where:{isActive:true}}),activeLines:await p.line.count({where:{deletedAt:null}}),activeSessions:await p.shiftSession.count({where:{status:'ACTIVE'}})};
 const factories=await p.factory.findMany({select:{id:true,code:true,isActive:true},orderBy:{code:'asc'}});
 const version=await(await fetch('http://127.0.0.1:3000/version')).json(),ready=await(await fetch('http://127.0.0.1:3000/ready')).json();assert.equal(version.version,'LOCAL03-20260924-C1');assert.equal(ready.ready,true);
 const out={status:'PASS_ADMIN01_IDENTITY_57_OWN_C1_BASELINE',atUtc:new Date().toISOString(),head:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),admin01FinalIdentity:prior.identity,files:snapshots,migrations,identity,counts,factories,version:version.version,ready:ready.ready,scope:'Source and own C1 identity/read-only only. New ADMIN02 target must be isolated before business actions.'};
 fs.writeFileSync(path.join(__dirname,'before.json'),JSON.stringify(out,null,2));console.log(JSON.stringify({status:out.status,files:snapshots.length,migrations:migrations.length,identity,counts}));
 }finally{await p.$disconnect();}
})().catch(e=>{console.error(e.message.replace(/postgres(?:ql)?:\/\/\S+/g,'[REDACTED]'));process.exitCode=1;});
