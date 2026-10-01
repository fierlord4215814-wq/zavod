// Current source proof. Real HTTP/auth + independent PostgreSQL lock/cancel, no mocked persistence.
const l=require('./live.cjs');
const receiptName='fault-before',fn='notify02_before_fault',marker='Учебная проверка долговечности N02';
(async()=>{const p=l.prisma(),q=l.prisma(),b=await l.chromium.launch({channel:'msedge',headless:true});
const ev=l.fs.existsSync(l.path.join(__dirname,receiptName+'.json'))?require('./fault-before.json'):{status:'IN_PROGRESS',cases:[]};
if(ev.error){(ev.priorObservations||=[]).push(ev.error);delete ev.error;}let hold,pending,trigger=false;
try{await l.identity(q);const a=await l.login(b,'ADMIN'),m=await l.login(b,'MASTER'),t=await l.login(b,'TECH_KIPIA',390),e=await l.login(b,'TECH_ELECTRIC',390);ev.browserHarness='PASS_REAL_EDGE_LOGINS_HTTP_WS';
const factory=a.me.selectedFactoryId,dept=t.me.departmentId;
ev.settings={orders:(await l.api(a.page,'GET','/orders/settings')).body,task:await q.taskSettings.findUnique({where:{factoryId:factory}})};
l.assert.equal(ev.settings.orders.lowStockNotificationsEnabled,true);l.assert.equal(ev.settings.task.longTaskEscalationEnabled,true);
async function createTask(label,long=false){const r=await l.api(m.page,'POST','/tasks',{type:long?'LONG':'URGENT',description:marker+' '+label,assigneeUserIds:[t.me.userId],departmentRecipientIds:[],operationId:'notify02-before-setup-'+label,...(long?{deadlineAt:new Date(Date.now()-86400000).toISOString()}:{})});l.assert.equal(r.status,201);return r.body.id;}
async function createRequest(label,departmentId){const body={title:marker+' '+label,description:'Изолированная учебная проверка',unit:'шт',requestedQuantity:1,reasonComment:'Проверка сохранности уведомления',departmentId,operationId:'notify02-before-'+label};return{body,call:()=>l.api(a.page,'POST','/orders/requests',body)};}
for(const key of ['request-department','request-factory','low-stock','request-close','task-done','task-redirect','task-escalated']){
 if(ev.cases.some(c=>c.key===key))continue;
 let event,id,operationId,actor=a,call,expectedBusiness;const label=key;
 if(key.startsWith('request-')&&key!=='request-close'){event='ORDER_REQUEST_CREATED';const c=await createRequest(label,key==='request-department'?dept:null);operationId=c.body.operationId;call=c.call;expectedBusiness='ACTIVE';}
 else if(key==='low-stock'){event='ORDER_STOCK_BELOW_THRESHOLD';const r=await l.api(a.page,'POST','/orders/items',{name:marker+' '+label,departmentId:null,initialQuantity:10,minThreshold:7,unit:'шт'});l.assert.equal(r.status,201);id=r.body.id;operationId='notify02-before-'+label;call=()=>l.api(a.page,'POST',`/orders/items/${id}/take`,{quantity:3,comment:'Проверка порога 10→7',operationId});expectedBusiness=7;}
 else if(key==='request-close'){event='ORDER_REQUEST_CLOSED';const c=await createRequest(label,dept),r=await c.call();l.assert.equal(r.status,201);id=r.body.id;call=()=>l.api(a.page,'POST',`/orders/requests/${id}/close`,{closeStatus:'ORDERED',comment:'Учебное решение'});expectedBusiness='ORDERED';}
 else{actor=m;event={ 'task-done':'TASK_DONE','task-redirect':'TASK_REDIRECTED','task-escalated':'TASK_LONG_ESCALATED'}[key];id=await createTask(label,key==='task-escalated');operationId=key==='task-escalated'?null:'notify02-before-'+key;
  call=key==='task-escalated'?()=>l.api(m.page,'POST','/tasks/escalation/check',{}):key==='task-done'?()=>l.api(m.page,'POST',`/tasks/${id}/complete`,{operationId,comment:'Учебное завершение'}):()=>l.api(m.page,'POST',`/tasks/${id}/redirect`,{operationId,newDepartmentRecipientIds:[e.me.departmentId],newAssigneeUserIds:[e.me.userId],comment:'Учебная передача'});expectedBusiness=key==='task-done'?'DONE':key==='task-escalated'?'ESCALATED':'NEW';}
 const oldRows=id?await l.notices(q,id):[];
 l.assert.equal((await q.$queryRawUnsafe('SELECT proname FROM pg_proc WHERE proname=$1',fn)).length,0,'No pre-existing owned trigger');
 await q.$executeRawUnsafe(`CREATE FUNCTION public.${fn}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.type='${event}' AND NEW.message LIKE '${marker}%' THEN PERFORM pg_advisory_xact_lock(712702,1); END IF; RETURN NEW; END $$`);
 await q.$executeRawUnsafe(`CREATE TRIGGER ${fn} BEFORE INSERT ON "Notification" FOR EACH ROW EXECUTE FUNCTION public.${fn}()`);trigger=true;
 hold=await l.barrier(p,'SELECT pg_advisory_xact_lock(712702,1)');pending=call();const w=await l.waiter(q,hold.pid,r=>r.query.startsWith('INSERT')&&r.query.includes('Notification'));
 if(!id){const op=await q.processedOperation.findUniqueOrThrow({where:{userId_operationId:{userId:actor.me.userId,operationId}}});id=op.resultKey;}
 const state=await l.eventState(q,event,id,operationId,actor.me.userId);l.assert(state.business);l.assert.equal(state.notifications.length,0);l.assert.equal(state.audit.length,1);
 if(event==='ORDER_STOCK_BELOW_THRESHOLD')l.assert.equal(state.business.currentQuantity,7);else if(event==='TASK_LONG_ESCALATED')l.assert(state.business.escalatedAt);else l.assert.equal(state.business.status,expectedBusiness);
 if(operationId)l.assert.equal(state.processed.length,1);if(event.startsWith('TASK_'))l.assert.equal(state.history.length,1);
 await l.cancel(q,w.pid,hold.pid);const failed=await pending;hold.release();await hold.finished;hold=null;pending=null;l.assert.equal(failed.status,500);
 await q.$executeRawUnsafe(`DROP TRIGGER ${fn} ON "Notification"`);await q.$executeRawUnsafe(`DROP FUNCTION public.${fn}()`);trigger=false;
 const retry=await call();l.assert.equal(retry.status,201);if(event==='TASK_LONG_ESCALATED')l.assert.equal(retry.body.escalated,0);else l.assert.equal(retry.body.id,id);
 const after=await l.eventState(q,event,id,operationId,actor.me.userId);l.assert.equal(after.notifications.length,0);l.assert.deepEqual(after.business,state.business);l.assert.deepEqual(after.history,state.history);l.assert.deepEqual(after.audit,state.audit);l.assert.deepEqual(after.processed,state.processed);
 const result={key,event,id,beforeOldRows:oldRows,independentCommittedBeforeCancel:state,barrier:{kind:'BEFORE Notification INSERT',holderPid:hold?.pid??null,waiterPid:w.pid,exactCancel:true},firstHttp:failed.status,retryHttp:retry.status,retryEscalated:retry.body.escalated,afterRetry:after,status:'PROVEN_LOSS_CURRENT_SOURCE'};
 if(event.startsWith('TASK_'))await l.done(m,id);else if(event==='ORDER_STOCK_BELOW_THRESHOLD')l.assert.equal((await l.api(a.page,'POST',`/orders/items/${id}/archive`,{comment:'Учебная проверка завершена'})).status,201);else await l.closeOrder(a,id);
 result.temporaryBusinessClosed=true;ev.cases.push(result);l.receipt(receiptName,ev);console.log(JSON.stringify({key,status:result.status,first:failed.status,retry:retry.status,notifications:0}));
}
ev.status='PASS_REPRODUCED_SIX_EVENTS_SEVEN_CASES_SQL_POSTCOMMIT_LOSS';l.receipt(receiptName,ev);
}catch(error){ev.error=l.safeError(error);l.receipt(receiptName,ev);throw error;}finally{hold?.release();await hold?.finished;await pending?.catch(()=>{});if(trigger){await q.$executeRawUnsafe(`DROP TRIGGER ${fn} ON "Notification"`);await q.$executeRawUnsafe(`DROP FUNCTION public.${fn}()`);}await p.$disconnect();await q.$disconnect();await b.close();}})().catch(e=>{console.error(l.safeError(e));process.exitCode=1;});
