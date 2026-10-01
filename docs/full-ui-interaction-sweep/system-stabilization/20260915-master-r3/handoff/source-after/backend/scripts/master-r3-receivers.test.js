require('./master-offline-guard.cjs');require('reflect-metadata');
const {test}=require('node:test'),assert=require('node:assert/strict');
const {taskFixture,taskBridgeFixture,actor}=require('./master-r2-task-fixture.cjs');
const {fixture}=require('./master-r2-publication-fixture.cjs'),{handoverFixture}=require('./master-r2-handover-fixture.cjs');
const {withIdentity}=require('./master-r2-authority-fixture.cjs');
test('R3-C2 opaque Task same entity cross-action is UNKNOWN durable kind not a proven complete',async()=>{
 const f=taskFixture(),row=await f.create();await f.service.takeTask(row.id,actor,'same-opaque');const writes=f.writes.length;
 const replay=await f.service.completeTask(row.id,actor,'same-opaque','Завершено');assert.equal(replay.status,'IN_PROGRESS');assert.equal(f.writes.length,writes);
 assert.deepEqual(Object.keys(f.operations.find(x=>x.operationId==='same-opaque')).filter(k=>/kind|fingerprint/i.test(k)),[]);
});
test('R3-F Task actual Audit writer Ops audit reader ProcessedOperation and Notifications receiver',()=>withIdentity(async()=>{
 const f=taskBridgeFixture(),u=await f.authorityFixture.resolve(f.user.userId,f.user.selectedFactoryId);
 const row=await f.controller.createTask({operationId:'r3-task-create',description:'Проверить датчик',assigneeUserIds:[u.userId]},u);
 await f.controller.takeTask(row.id,{operationId:'r3-task-take'},u);await f.controller.completeTask(row.id,{operationId:'r3-task-done',comment:'Проверено'},u);
 const before=f.tasks.length;await f.controller.completeTask(row.id,{operationId:'r3-task-done',comment:'Проверено'},u);assert.equal(f.tasks.length,before);
 assert.equal(f.operations.filter(x=>x.resultKey===row.id).length,3);assert.ok((await f.notification.list(u)).some(x=>x.entityId===row.id));
 await assert.rejects(f.ops.audit(u,{entityType:'Task',entityId:row.id}),e=>e.getStatus?.()===403);
 const manager=await f.authorityFixture.resolve('r3-management',u.selectedFactoryId);
 const audit=await f.ops.audit(manager,{entityType:'Task',entityId:row.id});assert.ok(audit.some(x=>x.action==='TASK_DONE'));assert.ok(f.audits.every(x=>x.factoryId===u.selectedFactoryId));
}));
test('R3-F Announcement actual Audit writer and Notifications receiver preserves one ACK after postcommit failure',async()=>{
 const f=fixture(true,'current','IMPORTANT',{},true);f.rejectNotice();await assert.rejects(f.controller.acknowledge(f.user,f.row.id),e=>e.getStatus?.()===503);
 assert.equal(f.reads.length,1);assert.equal(f.notice.readAt,null);await f.controller.acknowledge(f.user,f.row.id);
 assert.equal(f.audits.filter(x=>x.action==='ANNOUNCEMENT_ACKNOWLEDGED').length,1);assert.ok(f.audits.every(x=>x.entityId===f.row.id));assert.equal((await f.notification.unreadCount(f.user)).count,0);
});
test('R3-F ShiftLog actual Audit writer records exact ordinary writer entity',async()=>{
 const f=handoverFixture(true),row=await f.controller.createLog({text:'Проверить крепление',title:'Осмотр'},f.user);
 assert.ok(f.audits.some(x=>x.entityId===row.id&&x.factoryId===f.user.selectedFactoryId));assert.equal((await f.controller.getLog(f.user,row.id)).id,row.id);
});
