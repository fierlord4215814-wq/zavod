require('./master-offline-guard.cjs');require('reflect-metadata');
const{test}=require('node:test'),assert=require('node:assert/strict'),{taskBridgeFixture}=require('./master-r2-task-fixture.cjs');
const input=f=>({actor:f.user,operationId:'durable-create',description:'Проверка атомарного уведомления',assigneeUserIds:[f.user.userId]});
test('TASK-NOTIFY supplied transaction owns persistent rows; only committed rows are published',async()=>{
 const f=taskBridgeFixture(),original=f.data.$transaction;let active=false,transactions=0,published=0;
 f.data.$transaction=fn=>original(async tx=>{transactions++;active=true;try{return await fn(tx);}finally{active=false;}});
 const persist=f.notification.createOnceTx.bind(f.notification);f.notification.createOnceTx=async(tx,i)=>{assert(active);assert.equal(tx,f.db);return persist(tx,i);};
 f.notification.publishNotification=async n=>{assert(!active);assert(f.notices.some(r=>r.id===n.id));published++;};
 const task=await f.service.createTask(input(f));assert.equal(transactions,1);assert.equal(published,1);assert.equal(f.notices.length,1);assert.equal(f.notices[0].entityId,task.id);assert.equal(f.operations.length,1);assert.equal(f.histories.filter(h=>h.action==='TASK_CREATED').length,1);
});
test('TASK-NOTIFY persistence error propagates and never calls publication (rollback separately proven on PostgreSQL)',async()=>{
 const f=taskBridgeFixture();f.notification.createOnceTx=async()=>{throw Error('DB_WRITE_FAILURE');};f.notification.publishCommittedNotifications=()=>assert.fail('must not publish uncommitted rows');
 await assert.rejects(f.service.createTask(input(f)),/DB_WRITE_FAILURE/);
});
test('TASK-NOTIFY one recipient transport failure does not prevent later recipient or invalidate successful create',async()=>{
 const f=taskBridgeFixture(),seen=[];f.notification.publishNotification=async n=>{seen.push(n.userId);if(n.userId===f.user.userId)throw Error('TRANSPORT_FAILURE');};
 const task=await f.service.createTask({...input(f),assigneeUserIds:[f.user.userId,'r2-next-manager']});assert(task.id);assert.deepEqual(seen,[f.user.userId,'r2-next-manager']);assert.equal(f.notices.length,2);
});
test('TASK-NOTIFY failed task WS invalidation leaves successful result and durable record',async()=>{
 const f=taskBridgeFixture();f.ws.broadcast=()=>{throw Error('WS_FAILED');};const task=await f.service.createTask(input(f));assert.equal(f.notices[0].entityId,task.id);
});
test('TASK-NOTIFY replay after mutation never resolves recipients or persists/publishes again',async()=>{
 const f=taskBridgeFixture(),body=input(f),task=await f.service.createTask(body);f.tasks[0].status='DONE';f.assignees[0].active=false;const rows=structuredClone(f.notices);
 f.notification.persistTaskCreatedTx=()=>assert.fail('historic recipients must not be recalculated');f.notification.publishCommittedNotifications=()=>assert.fail('replay is not a new event');
 assert.equal((await f.service.createTask(body)).id,task.id);assert.deepEqual(f.notices,rows);
});
test('TASK-NOTIFY exact event dedupe retains distinct user/department scope rows',async()=>{
 const f=taskBridgeFixture(),i={factoryId:f.user.selectedFactoryId,userId:f.user.userId,type:'TASK_CREATED',title:'Новая заявка',message:'Исходное событие',entityType:'TASK',entityId:'dedupe-task'};
 const a=await f.notification.createOnceTx(f.db,i),b=await f.notification.createOnceTx(f.db,{...i,message:'Не новое событие'}),c=await f.notification.createOnceTx(f.db,{...i,departmentId:f.user.departmentId});
 assert(a.created);assert(!b.created);assert(c.created);assert.equal(a.notification.id,b.notification.id);assert.equal(b.notification.message,i.message);assert.notEqual(c.notification.id,a.notification.id);assert.equal(f.notices.length,2);assert.equal(f.events.length,0);
});
test('TASK-NOTIFY department fanout preserves ADMIN inclusion and explicit/dept overlap as separate rows',async()=>{
 const f=taskBridgeFixture();f.accesses[2].role='ADMIN';f.accesses[2].departmentId='different-department';
 const task=await f.service.createTask({...input(f),departmentRecipientIds:[f.user.departmentId]});
 const rows=f.notices.filter(n=>n.entityId===task.id);assert.equal(rows.length,4);
 assert.equal(rows.filter(n=>n.userId===f.user.userId).length,2);assert.equal(rows.filter(n=>n.userId==='r3-management'&&n.departmentId===f.user.departmentId).length,1);
 assert.equal((await f.notification.list(f.user)).filter(n=>n.entityId===task.id).length,1);
});
test('TASK-NOTIFY department recipients exclude inactive, guest and blocked at create time',async()=>{
 for(const state of ['inactive','guest','blocked']){const f=taskBridgeFixture();if(state==='inactive')f.accesses[1].isActive=false;if(state==='guest')f.accesses[1].isGuest=true;if(state==='blocked')f.accesses[1].user.blockedAt=new Date();
 const task=await f.service.createTask({...input(f),assigneeUserIds:[],departmentRecipientIds:[f.user.departmentId]});assert(!f.notices.some(n=>n.entityId===task.id&&n.userId==='r2-next-manager'));}
});
