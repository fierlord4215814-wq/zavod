require('./master-offline-guard.cjs');require('reflect-metadata');
const {test}=require('node:test'),assert=require('node:assert/strict');
const {handoverFixture}=require('./master-r2-handover-fixture.cjs'),{denied}=require('./master-r2-memory.cjs');
const {parseShiftHandover}=require('../dist/common/shift-handover');
const {PermissionGuard}=require('../dist/common/permission.guard'),{Reflector}=require('@nestjs/core');
test('R2-E-J14 actual saved snapshot preserves exact comment separately from ordinary comment and archive has no receipt',async()=>{
  const f=handoverFixture(),now=new Date('2026-09-15T16:30:00Z'),text='Следующей смене: проверить датчик.\nУпаковку оставить на линии.';
  assert.equal((await f.service.handoverAvailability(f.user,{},now)).available,true);
  const summary=await f.service.handoverSummary(f.user,{},now);assert.equal(summary.snapshot.sections.lines[0].lineId,f.lines[0].id);
  const result=await f.service.createHandover(f.user,{comment:'  '+text+'  '},now);assert.equal(result.handover.snapshot.comment,text);assert.equal(parseShiftHandover(f.logs[0].text).comment,text);
  const bytes=f.logs[0].text;f.lines[0].status='STOP';const reopened=await f.controller.getLog(f.user,result.id);assert.equal(reopened.handover.snapshot.comment,text);assert.equal(f.logs[0].text,bytes);assert.equal(reopened.handover.snapshot.sections.lines[0].currentStatus,'STOP');
  await assert.rejects(f.service.updateLog(f.user,result.id,{text:'Попытка изменения'}),denied);assert.equal(f.logs[0].text,bytes);
  const again=await f.service.createHandover(f.user,{comment:'Другая попытка'},now);assert.equal(again.id,result.id);assert.equal(again.handover.snapshot.comment,text);assert.equal(f.logs.length,1);
  const ordinary=await f.controller.createLog({text:'Обычная запись: проверить крепление',title:'Осмотр смены'},f.user);assert.equal(ordinary.handover,null);await f.controller.addComment(ordinary.id,{text:'Отдельный комментарий к записи'},f.user);
  const ordinaryRead=await f.controller.getLog(f.user,ordinary.id);assert.equal(ordinaryRead.comments[0].text,'Отдельный комментарий к записи');assert.equal(ordinaryRead.text,'Обычная запись: проверить крепление');
  await f.controller.markRead(f.user,ordinary.id);assert.equal(f.reads.length,1);
  // Explicit stored archive fixture; no forbidden attempt to archive an immutable snapshot.
  f.logs.find(x=>x.id===result.id).status='ARCHIVED';const writes=f.writes.length;const archive=await f.controller.getArchiveLog(f.user,result.id,{});assert.equal(archive.archiveReadOnly,true);assert.deepEqual(archive.availableActions,['read']);assert.equal(archive.handover.snapshot.comment,text);assert.equal(f.writes.length,writes);assert.equal(f.reads.length,1);
  await assert.rejects(f.controller.getArchiveLog({...f.user,selectedFactoryId:'foreign'},result.id,{}),denied);
});
for(const variant of ['outside-window','revoked','guest','no-manage','foreign-department','too-long'])test(`R2-E-J14 handover deny ${variant} before saved snapshot`,async()=>{
  const f=handoverFixture(),body={comment:'Передача'},now=new Date(variant==='outside-window'?'2026-09-15T06:00:00Z':'2026-09-15T16:30:00Z');
  if(variant==='revoked')f.access.isActive=false;if(variant==='guest')f.access.isGuest=true;if(variant==='no-manage')f.user.permissions=['shift-log.read'];if(variant==='foreign-department')body.departmentId='foreign';if(variant==='too-long')body.comment='А'.repeat(2001);
  await assert.rejects(f.service.createHandover(f.user,body,now),denied);assert.equal(f.logs.length,0);assert.equal(f.writes.length,0);
});
