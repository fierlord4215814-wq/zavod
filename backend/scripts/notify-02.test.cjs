require('./master-offline-guard.cjs');require('reflect-metadata');
const{test}=require('node:test'),assert=require('node:assert/strict'),{taskBridgeFixture}=require('./master-r2-task-fixture.cjs');
const{OrdersService}=require('../dist/modules/orders/orders.service'),{strict}=require('./master-r2-memory.cjs');
const kinds=['request-department','request-factory','low-stock','request-close','task-done','task-redirect','task-escalated'];
const event={ 'request-department':'ORDER_REQUEST_CREATED','request-factory':'ORDER_REQUEST_CREATED','low-stock':'ORDER_STOCK_BELOW_THRESHOLD','request-close':'ORDER_REQUEST_CLOSED','task-done':'TASK_DONE','task-redirect':'TASK_REDIRECTED','task-escalated':'TASK_LONG_ESCALATED'};
async function setup(kind){const f=taskBridgeFixture();f.notification.publishNotification=async()=>{};
 f.access.role='ADMIN';const admin={...f.user,isAdmin:true,role:'ADMIN'};
 const requests=[],items=[],movements=[];const req=f.model('orderRequest',requests,{includes:['sourceItem'],defaults:{status:'ACTIVE',sourceItem:null}});
 f.data.orderRequest=strict({...req,findUniqueOrThrow:async q=>{const row=await req.findUnique(q);assert(row);return row;}});
 // Match schema MinimumStockItem.isActive @default(true); the strict memory model has no schema defaults.
 f.data.minimumStockItem=f.model('minimumStockItem',items,{defaults:{isActive:true}});f.data.minimumStockMovement=f.model('minimumStockMovement',movements);
 f.data.orderSettings=strict({findUnique:async()=>({takeRequiresComment:true,restockRequiresComment:true,lowStockNotificationsEnabled:true,defaultUnit:'шт'})});
 f.data.taskSettings=strict({findUnique:async()=>({taskDoneRequiresComment:true,taskRedirectRequiresComment:true,longTaskEscalationEnabled:true,longTaskEscalationGraceMinutes:0})});
 const orders=new OrdersService({db:f.db},f.attachments,f.audit,f.notification,f.ws),requestBody={title:'Рабочий заказ',departmentId:kind==='request-factory'?null:f.user.departmentId,unit:'шт',reasonComment:'Рабочая потребность',operationId:'n02-order'};
 let run,id;
 if(kind.startsWith('request-')&&kind!=='request-close')run=()=>orders.createManualRequest(admin,requestBody);
 else if(kind==='request-close'){id=(await orders.createManualRequest(admin,requestBody)).id;run=()=>orders.closeRequest(admin,id,{closeStatus:'ORDERED'});}
 else if(kind==='low-stock'){id=(await orders.createItem(admin,{name:'Рабочий остаток',departmentId:null,unit:'шт',initialQuantity:10,minThreshold:7})).id;run=()=>orders.take(admin,id,{quantity:3,comment:'Рабочий расход',operationId:'n02-take'});}
 else{id=(await f.service.createTask({actor:f.user,operationId:'n02-task',description:'Рабочая заявка',type:kind==='task-escalated'?'LONG':'URGENT',assigneeUserIds:['r2-next-manager'],...(kind==='task-escalated'?{deadlineAt:new Date(Date.now()-86400000).toISOString()}:{})})).id;f.tasks[0].escalatedAt=null;
  run=kind==='task-done'?()=>f.service.completeTask(id,f.user,'n02-complete','Работа выполнена'):kind==='task-redirect'?()=>f.service.redirectTask(id,f.user,{operationId:'n02-redirect',newDepartmentRecipientIds:[f.user.departmentId],newAssigneeUserIds:['r2-next-manager'],comment:'Передача'}):()=>f.service.checkOverdueLongTasks(f.user);}
 return{...f,orders,admin,requests,items,movements,run,id,event:event[kind]};
}
for(const kind of kinds)test(`NOTIFY02 ${kind}: required rows use business tx; no publication before commit`,async()=>{
 const f=await setup(kind),original=f.data.$transaction;let active=false,transactions=0,published=0,persisted=0;
 f.data.$transaction=fn=>original(async tx=>{transactions++;active=true;try{return await fn(tx);}finally{active=false;}});
 const persist=f.notification.createOnceTx.bind(f.notification);f.notification.createOnceTx=async(tx,input)=>{assert(active);assert.equal(tx,f.db);if(input.type===f.event)persisted++;return persist(tx,input);};
 f.notification.publishNotification=async row=>{assert(!active);assert.equal(row.type,f.event);assert(f.notices.some(n=>n.id===row.id));published++;};
 await f.run();assert.equal(transactions,1);assert(persisted>0);assert.equal(published,persisted);const rows=f.notices.filter(n=>n.type===f.event);assert.equal(rows.length,persisted);
 const ids=rows.map(n=>n.id);f.notification.createOnceTx=()=>assert.fail('replay must not recalculate event recipients');await f.run();assert.deepEqual(f.notices.filter(n=>n.type===f.event).map(n=>n.id),ids);assert.equal(published,persisted);
});
test('NOTIFY02 persistence failure propagates in each event; no postcommit publication (SQL rollback proved separately)',async()=>{
 for(const kind of kinds){const f=await setup(kind);f.notification.createOnceTx=async()=>{throw Error('REQUIRED_DB_WRITE_FAILED');};f.notification.publishCommittedNotifications=()=>assert.fail('uncommitted publication');await assert.rejects(f.run(),/REQUIRED_DB_WRITE_FAILED/);}
});
test('NOTIFY02 publication/first recipient/unread/invalidation throws are isolated for every event',async()=>{
 for(const kind of kinds){const f=await setup(kind),seen=[];f.notification.publishNotification=async n=>{seen.push(n.id);if(seen.length===1)throw Error('PUSH_OR_WS_TRANSPORT');};f.ws.sendToUsers=()=>{throw Error('COUNT_WS');};f.ws.broadcast=()=>{throw Error('ENTITY_WS');};await f.run();assert.deepEqual(seen,f.notices.filter(n=>n.type===f.event).map(n=>n.id));assert(seen.length>0);}
});
test('NOTIFY02 DONE/CLOSE resolve old rows atomically; unchanged retry retains current readAt semantics',async()=>{
 for(const kind of ['task-done','request-close']){const f=await setup(kind);assert(f.notices.some(n=>!n.readAt));await f.run();assert(f.notices.filter(n=>n.type!==f.event).every(n=>n.readAt));assert(f.notices.filter(n=>n.type===f.event).every(n=>!n.readAt));await f.run();assert(f.notices.every(n=>n.readAt));}
});
test('NOTIFY02 low-stock dedupe remains item/user scoped across more TAKE, RESTOCK and decline',async()=>{
 const f=await setup('low-stock');await f.run();const rows=structuredClone(f.notices.filter(n=>n.type===f.event));
 await f.orders.take(f.admin,f.id,{quantity:1,comment:'Ещё расход',operationId:'n02-more'});await f.orders.restock(f.admin,f.id,{quantity:4,comment:'Пополнение',operationId:'n02-stock'});await f.orders.take(f.admin,f.id,{quantity:3,comment:'Новый расход',operationId:'n02-again'});
 assert.equal(f.items[0].currentQuantity,7);assert.deepEqual(f.notices.filter(n=>n.type===f.event),rows);assert.equal(f.movements.length,4);
});
test('NOTIFY02 factory request stays one shared row, department fanout includes ADMIN but excludes inactive users',async()=>{
 const a=await setup('request-factory');await a.run();const n=a.notices.filter(n=>n.type===a.event);assert.equal(n.length,1);assert.equal(n[0].userId,null);assert.equal(n[0].departmentId,null);
 for(const state of ['inactive','guest','blocked','deleted']){const f=await setup('request-department');if(state==='inactive')f.accesses[1].isActive=false;if(state==='guest')f.accesses[1].isGuest=true;if(state==='blocked')f.accesses[1].user.blockedAt=new Date();if(state==='deleted')f.accesses[1].user.deletedAt=new Date();await f.run();assert(!f.notices.some(n=>n.type===f.event&&n.userId==='r2-next-manager'));assert(f.notices.some(n=>n.type===f.event&&n.userId===f.user.userId));}
});
test('NOTIFY02 scanner takes canonical task lock and repeated scan does not duplicate history/audit',async()=>{
 const f=await setup('task-escalated');const r=await f.run();assert.equal(r.escalated,1);assert(f.locks.some(keys=>keys.includes('task:'+f.id)));assert.equal((await f.run()).escalated,0);assert.equal(f.histories.filter(h=>h.action===f.event).length,1);assert.equal(f.audits.filter(h=>h.action===f.event).length,1);
});
