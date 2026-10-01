require('./master-offline-guard.cjs');require('reflect-metadata');
const {test}=require('node:test'),assert=require('node:assert/strict');
const {taskBridgeFixture}=require('./master-r2-task-fixture.cjs'),{strict,denied}=require('./master-r2-memory.cjs'),{withIdentity}=require('./master-r2-authority-fixture.cjs');
const {QuantityReleaseService}=require('../dist/common/quantity-release.service'),{OkkService}=require('../dist/modules/okk/okk.service');
async function setup(kind='OKK'){
 const f=taskBridgeFixture();f.user.permissions.push('okk.read','okk.manage','returns.manage');const user=await f.authorityFixture.resolve(f.user.userId,f.user.selectedFactoryId),rows=[],releases=[];
 f.data.line=f.model('line',[{id:'quality-line',factoryId:user.selectedFactoryId,name:'Линия упаковки',deletedAt:null}]);
 f.data.okkRecord=f.model('okkRecord',rows);f.data.returnRecord=f.model('returnRecord',rows);f.data.quantityReleaseOperation=f.model('quantityReleaseOperation',releases,{unique:[['operationId']]});
 const quantity=new QuantityReleaseService({db:f.db},f.audit,f.ws),okk=new OkkService({db:f.db},f.ws,strict({sendPush:()=>{}}),f.audit,f.attachments,quantity);
 const record=kind==='OKK'?await okk.createRecord(user,{lineId:'quality-line',assignedMasterId:user.userId,defectDate:'2026-09-15',shiftLabel:'DAY',productName:'Упаковка',article:'А-10',mismatchReason:'Нарушена маркировка',defectQuantity:'10 штук',operationId:'quality-origin'}):{id:'return-origin',factoryId:user.selectedFactoryId,quantity:10,unit:'штуки',status:'ACTIVE',archivedAt:null,deletedAt:null};
 if(kind==='RETURN')rows.push(record);
 const call=body=>kind==='OKK'?okk.partialRelease(user,record.id,body):quantity.releaseReturn(user,record.id,body);
 return {...f,user,rows,releases,record,quantity,okk,call};
}
for(const kind of ['OKK','RETURN'])for(const field of ['quantity','comment'])test(`R3-E-J15 ${kind} immutable release retry denies changed ${field}`,()=>withIdentity(async()=>{
 const f=await setup(kind),body={quantity:3,comment:'Проверено',operationId:'release-one'};await f.call(body);const writes=f.writes.length;
 await assert.rejects(f.call({...body,[field]:field==='quantity'?7:'Иное решение'}),denied);assert.equal(f.writes.length,writes);assert.equal(f.releases.length,1);
}));
test('R3-E-J15 actual OKK create partial3 remaining7 final replay same history archive Audit Ops IDs',()=>withIdentity(async()=>{
 const f=await setup(),body={quantity:3,comment:'Проверено',operationId:'partial-a'};assert.equal((await f.okk.listRecords(f.user,f.user.selectedFactoryId))[0].id,f.record.id);
 const partial=await f.call(body);assert.equal(partial.operation.quantityAfter,'7');assert.equal((await f.call({...body,quantity:'3,000',comment:' Проверено '})).operation.id,partial.operation.id);
 const middle=(await f.okk.listRecords(f.user,f.user.selectedFactoryId))[0];assert.equal(middle.id,f.record.id);assert.equal(middle.quantitySummary.remaining,'7');assert.equal(middle.releaseHistory[0].id,partial.operation.id);
 const complete={quantity:7,comment:'Выпущен остаток',operationId:'partial-b'},final=await f.call(complete);assert.equal(final.archived,true);assert.equal((await f.call(complete)).operation.id,final.operation.id);assert.equal(f.releases.length,2);
 assert.equal((await f.okk.listRecords(f.user,f.user.selectedFactoryId)).length,0);const archived=(await f.okk.listRecords(f.user,f.user.selectedFactoryId,undefined,true))[0];assert.equal(archived.id,f.record.id);assert.equal(archived.quantitySummary.remaining,'0');assert.deepEqual(new Set(archived.releaseHistory.map(x=>x.id)),new Set([partial.operation.id,final.operation.id]));
 const auditRows=f.audits.filter(x=>x.action==='OKK_QUANTITY_PARTIALLY_RELEASED');assert.equal(auditRows.length,2);assert.deepEqual(auditRows.map(x=>x.details.quantityAfter),['7','0']);assert.ok(auditRows.every(x=>x.entityId===f.record.id));
 const manager=await f.authorityFixture.resolve('r3-management',f.user.selectedFactoryId),ops=await f.ops.audit(manager,{entityType:'OkkRecord',entityId:f.record.id});assert.deepEqual(new Set(ops.filter(x=>x.action==='OKK_QUANTITY_PARTIALLY_RELEASED').map(x=>x.id)),new Set(auditRows.map(x=>x.id)));
 assert.equal(f.tasks.length,0,'No automatic OKK to Task edge is invented');
}));
