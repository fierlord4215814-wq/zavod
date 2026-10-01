'use strict';
const {fs,path,assert,db,fixture,auth,http,ok,A0}=require('./harness.cjs');
const file=path.join(__dirname,'http-security.json'),ev=fs.existsSync(file)?JSON.parse(fs.readFileSync(file)):{status:'IN_PROGRESS',checks:[]};const save=()=>fs.writeFileSync(file,JSON.stringify(ev,null,2));
(async()=>{assert(!ev.status.startsWith('PASS'));const p=await db(),f=fixture(),admin=await auth('admin',f.C),m=await auth('master',f.C),m2=await auth('secondMaster',f.C),id=f.users.probe.id;
 // Recover only this script's exact owned soft-deleted counterexample before login.
 await p.user.update({where:{id},data:{blockedAt:null,deletedAt:null}});
 const w=await auth('probe',f.C);
 async function check(name,a,method,url,body,statuses){const r=await http(a,method,url,body);assert(statuses.includes(r.status),`${name}: ${r.status} ${r.body?.message}`);ev.checks.push({name,status:r.status,message:r.body?.message});save();return r.body;}
 async function restore(){await p.user.update({where:{id},data:{blockedAt:null,deletedAt:null}});await ok(admin,'POST',`/admin/users/${id}/factory-access`,{factoryId:f.C,role:'WORKER',departmentId:f.department,isGuest:false,reason:'ADMIN02 restore own target'});}
 try{
 assert.equal((await p.user.findUnique({where:{id},select:{employeeState:true}})).employeeState,'OFF_SHIFT');
 await check('SENT_HOME_C_REQUEST_A0_DENY',{...w,factoryId:A0},'POST','/shift/return-request',{reason:'Не тот завод'},[409]);
 await check('WORKER_CANNOT_MANAGE_RETURN',w,'GET','/shift/return-requests',undefined,[403]);
 await check('WORKER_CANNOT_SEND_HOME',w,'POST','/shift/send-home',{targetUserId:id,comment:'Нет права'},[403]);
 await ok(admin,'PATCH','/admin/shift-settings',{returnRequestEnabled:false,reason:'ADMIN02 bounded disabled guard'});
 await check('RETURN_DISABLED',w,'POST','/shift/return-request',{reason:'Отключено'},[409]);
 await ok(admin,'PATCH','/admin/shift-settings',{returnRequestEnabled:true,reason:'ADMIN02 restore'});
 for(const kind of['revoked','guest','blocked','deleted']){
  if(kind==='revoked')await ok(admin,'PATCH',`/admin/users/${id}/factory-access`,{factoryId:f.C,isActive:false,reason:'ADMIN02 stale-token guard'});
  if(kind==='guest')await ok(admin,'POST',`/admin/users/${id}/factory-access`,{factoryId:f.C,role:'WORKER',isGuest:true,departmentId:f.department,reason:'ADMIN02 guest guard'});
  if(kind==='blocked')await ok(admin,'PATCH',`/admin/users/${id}/block-status`,{blocked:true,reason:'ADMIN02 blocked guard'});
  // A soft-deleted counterexample is only an owned disposable fixture; no history is removed.
  if(kind==='deleted')await p.user.update({where:{id},data:{deletedAt:new Date()}});
  const count=await p.shiftReturnRequest.count({where:{userId:id}});
  await check(`STALE_TOKEN_${kind}_REQUEST_DENY`,w,'POST','/shift/return-request',{reason:'Не должен сохраниться'},[401,403]);
  await check(`MASTER_TARGET_${kind}_SEND_HOME_DENY`,m,'POST','/shift/send-home',{targetUserId:id,comment:'Недоступный target'},[409]);
  assert.equal(await p.shiftReturnRequest.count({where:{userId:id}}),count);
  await restore();
 }
 const refreshed=await auth('probe',f.C);const r=await check('VALID_C_REQUEST',refreshed,'POST','/shift/return-request',{reason:'Готов вернуться после проверки доступа'},[201]);ev.requestId=r.id;
 await check('DUPLICATE_PENDING',refreshed,'POST','/shift/return-request',{reason:'Повтор'},[409]);
 await check('FOREIGN_REQUEST_OBJECT',{...m,factoryId:A0},'PATCH',`/shift/return-requests/${r.id}`,{status:'APPROVED'},[409]);
 const results=await Promise.all([http(m,'PATCH',`/shift/return-requests/${r.id}`,{status:'APPROVED'}),http(m2,'PATCH',`/shift/return-requests/${r.id}`,{status:'REJECTED',decisionComment:'Конкурентный мастер'})]);assert.deepEqual(results.map(x=>x.status).sort(),[200,409]);const row=await p.shiftReturnRequest.findUnique({where:{id:r.id},select:{id:true,status:true,decidedById:true,decisionComment:true}});const count=await p.auditLog.count({where:{entityId:r.id,action:{in:['SHIFT_RETURN_APPROVED','SHIFT_RETURN_REJECTED']}}});assert.equal(count,1);ev.httpConcurrency={statuses:results.map(x=>x.status),row,auditCount:count};
 const list=await ok(m,'GET','/shift/return-requests');assert(list.some(v=>v.id===r.id));assert(!JSON.stringify(list).match(/passwordHash|storagePath|authUpdatedAt|passwordRecovery|normalizedPhone|token/i));ev.safeReturnList=true;
 ev.status='PASS_REAL_HTTP_AUTH_GUARDS_SCOPED_PROVENANCE_AND_CONCURRENT_DECISIONS';save();console.log(JSON.stringify({status:ev.status,checks:ev.checks.length,race:ev.httpConcurrency}));
 }catch(e){ev.error=e.message;save();throw e;}finally{await restore();await ok(admin,'PATCH','/admin/shift-settings',{returnRequestEnabled:true,sendHomeRequiresComment:true,reason:'ADMIN02 final fixture settings restore'});await p.$disconnect();}
})().catch(e=>{console.error(e.message.replace(/postgres(?:ql)?:\/\/\S+/g,'[REDACTED]'));process.exitCode=1;});
