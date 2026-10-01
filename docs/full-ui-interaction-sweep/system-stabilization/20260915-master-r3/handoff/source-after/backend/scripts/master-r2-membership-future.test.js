require('./master-offline-guard.cjs'); require('reflect-metadata');
const {test} = require('node:test'), assert = require('node:assert/strict');
const {memory,strict,copy,denied} = require('./master-r2-memory.cjs');
const {ChatsService} = require('../dist/modules/chats/chats.service');
const {ShiftService} = require('../dist/modules/shift/shift.service');
const {chatFixture}=require('./master-r2-chat-fixture.cjs');
for(const action of ['add','remove','role','transfer','block','leave']) for(const scenario of ['valid','wrong-member','missing-result','revoked-under-lock']) test(`R2-A/E-J20 ${action} replay ${scenario}`,async()=>{
  const f=chatFixture(action);
  const operation={userId:f.user.userId,operationId:f.operationId,resultKey:scenario==='wrong-member'?f.members[2].id:scenario==='missing-result'?null:f.target.id};
  if(action==='leave') f.members[0].membershipRole='MEMBER';
  if(scenario==='revoked-under-lock') {
    // Operation commits while this request waits: model only deterministic order,
    // not SQL scheduling. The outer read has already seen the old membership.
    const lock=f.data.$executeRaw; let once=false;
    f.data.$executeRaw=async(...args)=>{const result=await lock(...args); if(!once){once=true;f.operations.push(operation);f.members[0].removedAt=new Date();f.members[0].canRead=false;} return result;};
  } else f.operations.push(operation);
  if(scenario==='valid') {const result=await f.call(); if(action==='block')assert.equal(result.chatId,f.chat.id);else assert.equal(result.userId,f.target.userId);}
  else await assert.rejects(f.call(),error=>{assert.ok(denied(error),error.stack);return true;});
  assert.equal(f.writes.length,0); assert.equal(f.messages.length,0);
});
for(const action of ['add','role','transfer','block']) test(`R2-A/E-J20 ${action} first success lost response current-state retry`,async()=>{
  const f=chatFixture(action); if(action==='add'){f.target.canRead=false;f.target.removedAt=new Date();}
  const first=await f.call(), writes=f.writes.length, count=f.messages.length, auditCount=f.audits.length;
  const second=await f.call(); assert.deepEqual(second,first); assert.equal(f.writes.length,writes);assert.equal(f.messages.length,count);assert.equal(f.audits.length,auditCount);assert.equal(f.operations.length,1);
  if(action==='transfer') {assert.equal(f.members.filter(x=>x.membershipRole==='OWNER').length,1);assert.equal(f.members[0].membershipRole,'MEMBER');}
  f.members[0].canRead=false;f.members[0].removedAt=new Date();await assert.rejects(f.call(),denied);assert.equal(f.writes.length,writes);
});
function futureFixture(kind='WASH') {
  const m=memory(),user={userId:'future-master',selectedFactoryId:'future-factory',departmentId:'future-dept',role:'MASTER',isAdmin:false,isGuest:false,permissions:['shift.assign']};
  const worker={id:'future-worker',blockedAt:null,deletedAt:null},access={userId:worker.id,factoryId:user.selectedFactoryId,isActive:true,isGuest:false,role:'WORKER',user:worker};
  const area={id:'future-area',factoryId:user.selectedFactoryId,assignmentKind:kind,isActive:true,deletedAt:null};
  const position={id:'future-position',workAreaId:area.id,workArea:area,isActive:true,deletedAt:null,plannedCount:2,defaultPlanned:2};
  const service=new ShiftService({db:m.db},strict({}),m.audit,strict({}),strict({}),m.ws);
  const body={targetUserId:worker.id,shiftDate:'2030-01-01',shiftType:'DAY',kind,operationId:'future-create',...(kind==='WASH'?{}:{workAreaId:area.id,workAreaPositionId:position.id,slotIndex:1})};
  const target=service.resolveFutureTarget(body);
  const row={id:'future-plan',factoryId:user.selectedFactoryId,userId:worker.id,kind,shiftDate:target.shiftDate,shiftType:target.shiftType,workAreaId:body.workAreaId??null,workAreaPositionId:body.workAreaPositionId??null,slotIndex:body.slotIndex??null,timeRoleName:null,releasedAt:new Date()};
  const rows=[row];m.data.plannedShiftAssignment=m.model('plannedShiftAssignment',rows);m.data.plannedLineAssignment=m.model('plannedLineAssignment',[]);m.data.userFactoryAccess=m.model('userFactoryAccess',[access],{includes:['user'],compounds:['userId_factoryId']});m.data.workAreaPosition=m.model('workAreaPosition',[position],{includes:['workArea']});
  m.operations.push({userId:user.userId,operationId:body.operationId,resultKey:row.id});
  return {...m,user,worker,access,area,position,rows,row,body,service,call:()=>service.createFutureShiftAssignment(user,body)};
}
for(const kind of ['WASH','TIME','WORK_AREA']) for(const scenario of ['valid-released','wrong-user','wrong-kind','wrong-date','wrong-shift','revoked-worker','foreign','wrong-slot']) test(`R2-A/E-J03 future ${kind} replay ${scenario}`,async()=>{
  const f=futureFixture(kind);
  if(scenario==='wrong-user')f.row.userId='other-worker';if(scenario==='wrong-kind')f.row.kind='LINE';if(scenario==='wrong-date')f.row.shiftDate=new Date('2030-01-02');if(scenario==='wrong-shift')f.row.shiftType='NIGHT';if(scenario==='revoked-worker')f.access.isActive=false;if(scenario==='foreign')f.row.factoryId='foreign';if(scenario==='wrong-slot')f.row.slotIndex=9;
  if(scenario==='valid-released')assert.equal((await f.call()).id,f.row.id);else await assert.rejects(f.call(),error=>{assert.ok(denied(error),error.stack);return true;});
  assert.equal(f.writes.length,0);assert.equal(f.audits.length,0);
});
test('R2-A/E-J03 future WASH first create retry changes no factual assignment',async()=>{
  const f=futureFixture();f.rows.length=0;f.operations.length=0;
  const first=await f.call(),writes=f.writes.length;const replay=await f.call();assert.equal(replay.id,first.id);assert.equal(f.rows.length,1);assert.equal(f.writes.length,writes);
  // No assignment/user writes or factual reader is supplied: any such access fails.
  assert.ok(f.writes.every(w=>['plannedShiftAssignment','processedOperation'].includes(w.label)));
});
for(const sample of [
 ['DAY','2030-01-01T07:59:59+03:00','2030-01-01T08:00:00+03:00',true],
 ['DAY','2030-01-01T19:59:59+03:00','2030-01-01T20:00:00+03:00',false],
 ['NIGHT','2030-01-01T19:59:59+03:00','2030-01-01T20:00:00+03:00',true],
 ['NIGHT','2030-01-01T23:59:59+03:00','2030-01-02T00:00:00+03:00',true],
 ['NIGHT','2030-01-02T07:59:59+03:00','2030-01-02T08:00:00+03:00',false],
])test(`R3-C3 existing future ${sample[0]} first and saved-result across ${sample[2]} policy=${sample[3]?'read':'deny'}`,async()=>{
 const oldMode=process.env.NODE_ENV,oldNow=process.env.ZAVOD_INTERNAL_TEST_NOW;
 process.env.NODE_ENV='test';process.env.ZAVOD_INTERNAL_TEST_NOW='2029-12-31T12:00:00+03:00';
 try{
  const f=futureFixture();f.body.shiftType=sample[0];f.rows.length=0;f.operations.length=0;
  process.env.ZAVOD_INTERNAL_TEST_NOW=sample[1];const first=await f.call(),writes=f.writes.length;
  process.env.ZAVOD_INTERNAL_TEST_NOW=sample[2];
  if(sample[3])assert.equal((await f.call()).id,first.id);else await assert.rejects(f.call(),denied);
  assert.equal(f.writes.length,writes);assert.equal(f.rows.length,1);
  // A separate first command must follow the same established current/past boundary.
  f.body.operationId='fresh-after-boundary';f.rows.length=0;f.operations.length=0;
  if(sample[3])assert.ok((await f.call()).id);else {await assert.rejects(f.call(),denied);assert.equal(f.rows.length,0);}
 }finally{if(oldMode===undefined)delete process.env.NODE_ENV;else process.env.NODE_ENV=oldMode;if(oldNow===undefined)delete process.env.ZAVOD_INTERNAL_TEST_NOW;else process.env.ZAVOD_INTERNAL_TEST_NOW=oldNow;}
});
for(const action of ['create','release'])test(`R3-C3 future ${action} lost response replay emits no second update`,async()=>{
 const f=futureFixture();f.operations.length=0;f.row.releasedAt=null;if(action==='create')f.rows.length=0;
 const call=()=>action==='create'?f.call():f.service.releaseFutureShiftAssignment(f.user,f.row.id,{operationId:'future-release'});
 const first=await call(),writes=f.writes.length,audits=f.audits.length,events=f.events.length;
 const replay=await call();assert.equal(replay.id,first.id);assert.equal(f.writes.length,writes);assert.equal(f.audits.length,audits);assert.equal(events,1);assert.equal(f.events.length,events);
});
