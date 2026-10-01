require('./master-offline-guard.cjs'); require('reflect-metadata');
const {test}=require('node:test'),assert=require('node:assert/strict');
const {memory,strict,copy,denied}=require('./master-r2-memory.cjs');
const {OrdersService}=require('../dist/modules/orders/orders.service');
function fixture(){
  const m=memory(),user={userId:'order-actor',selectedFactoryId:'order-factory',departmentId:'order-dept',role:'STORE',isAdmin:false,isGuest:false,permissions:['orders.read','orders.request','orders.requests.manage','orders.restock']};
  const rows=[],notices=[],departments=[{id:user.departmentId,factoryId:user.selectedFactoryId,name:'Склад',scope:'FACTORY',deletedAt:null}];
  const model=m.model('orderRequest',rows,{includes:['sourceItem'],defaults:{status:'ACTIVE',sourceItem:null}});
  m.data.orderRequest=strict({...model,findUniqueOrThrow:async q=>{const row=await model.findUnique(q);assert.ok(row,'EXPLICIT fixture findUniqueOrThrow');return row;}});
  m.data.department=m.model('department',departments);m.data.userFactoryAccess=m.model('userFactoryAccess',[{factoryId:user.selectedFactoryId,userId:user.userId,user:{id:user.userId,firstName:'Мария',lastName:'Складская'},department:{name:'Склад'}}]);
  let failNotice=false;
  const notify=strict(Object.fromEntries(['notifyOrderRequestCreated','notifyOrderRequestClosed','resolveEntityNotifications'].map(name=>[name,async(...args)=>{notices.push({name,args:copy(args)});if(failNotice){failNotice=false;throw Object.assign(Error('NOTICE_UNAVAILABLE'),{getStatus:()=>503});}}])));
  const service=new OrdersService({db:m.db},m.attachments,m.audit,notify,m.ws);
  const body={title:'Перчатки рабочие',reasonComment:'Пополнение расходных материалов',requestedQuantity:12,unit:'шт',operationId:'order-create'};
  return {...m,user,rows,notices,service,body,create:()=>service.createManualRequest(user,body),failNotice:()=>{failNotice=true;}};
}
test('R2-E-J18 active OrderRequest detail is the same visible current entity',async()=>{const f=fixture(),row=await f.create();assert.equal((await f.service.requests(f.user,{}))[0].id,row.id);assert.equal((await f.service.request(f.user,row.id)).id,row.id);});
test('R2-A order create replay observes the same current entity read classification',async()=>{
  const f=fixture(),row=await f.create();f.rows[0].title='__PFFV5_P17C_BROWSER_123456__';
  await assert.rejects(f.service.request(f.user,row.id),denied);const writes=f.writes.length;
  await assert.rejects(f.create(),denied);assert.equal(f.writes.length,writes);
});
for(const status of ['ORDERED','NOT_NEEDED'])test(`R2-E-J18 OrderRequest ${status} lifecycle retry readers and granular rights`,async()=>{
  const f=fixture(),row=await f.create();const count=f.writes.length;assert.equal((await f.create()).id,row.id);assert.equal(f.writes.length,count);
  const input={closeStatus:status,comment:'Решение снабжения'};
  await assert.rejects(f.service.closeRequest({...f.user,permissions:['orders.restock','orders.request']},row.id,input),denied);
  await assert.rejects(f.service.closeRequest({...f.user,selectedFactoryId:'foreign'},row.id,input),denied);
  await assert.rejects(f.service.closeRequest(f.user,row.id,{closeStatus:'NOT_NEEDED',comment:''}),denied);assert.equal(f.rows[0].status,'ACTIVE');
  const closed=await f.service.closeRequest(f.user,row.id,input);assert.equal(closed.status,status);assert.equal((await f.service.requests(f.user,{})).length,0);assert.equal((await f.service.requests(f.user,{archive:'true'}))[0].id,row.id);assert.equal((await f.service.request(f.user,row.id)).status,status);
  const writes=f.writes.length;await f.service.closeRequest(f.user,row.id,input);assert.equal(f.writes.length,writes);
  assert.equal((await f.create()).status,status,'committed create result remains readable after close');assert.equal(f.writes.length,writes);assert.equal(f.rows.length,1);
  await assert.rejects(f.service.closeRequest(f.user,row.id,{closeStatus:status==='ORDERED'?'NOT_NEEDED':'ORDERED',comment:'Другое решение'}),denied);assert.equal(f.writes.length,writes);
});
for(const scenario of ['null-result','wrong-owner','wrong-source-type','foreign-result','wrong-department'])test(`R2-A/E-J18 create replay ${scenario}`,async()=>{
  const f=fixture();await f.create();const row=f.rows[0];
  if(scenario==='null-result')f.operations[0].resultKey=null;if(scenario==='wrong-owner')row.createdById='other-user';if(scenario==='wrong-source-type')row.sourceType='AUTO_FROM_STOCK';if(scenario==='foreign-result')row.factoryId='foreign';if(scenario==='wrong-department')row.departmentId='other-dept';
  const writes=f.writes.length;await assert.rejects(f.create(),error=>{assert.ok(denied(error),error.stack);return true;});assert.equal(f.writes.length,writes);assert.equal(f.rows.length,1);
});
test('R2-E-J18 notification failure after create does not duplicate business result',async()=>{const f=fixture();f.failNotice();await assert.rejects(f.create(),e=>e.getStatus?.()===503);assert.equal(f.rows.length,1);const writes=f.writes.length;assert.equal((await f.create()).id,f.rows[0].id);assert.equal(f.writes.length,writes);});
test('R2-E-J18 simultaneous different close decisions have one memory winner',async()=>{const f=fixture(),row=await f.create();const results=await Promise.allSettled([f.service.closeRequest(f.user,row.id,{closeStatus:'ORDERED'}),f.service.closeRequest(f.user,row.id,{closeStatus:'NOT_NEEDED',comment:'Отмена'})]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);const rejected=results.find(r=>r.status==='rejected');assert.ok(denied(rejected.reason));assert.equal(f.rows[0].status,'ORDERED');assert.equal(f.audits.filter(a=>a.action==='ORDER_REQUEST_CLOSED').length,1);});
