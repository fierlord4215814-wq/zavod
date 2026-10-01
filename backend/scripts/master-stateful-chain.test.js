// Real services sharing one strict memory repository. No transaction/concurrency claim.
require('./master-offline-guard.cjs');require('reflect-metadata');
const {test}=require('node:test'),assert=require('node:assert/strict');
const {TaskService}=require('../dist/modules/task/task.service');
const {NotificationsService}=require('../dist/modules/notifications/notifications.service');
const {OpsService}=require('../dist/modules/ops/ops.service');
const handover=require('../dist/common/shift-handover');
const {ChecklistsService}=require('../dist/modules/checklists/checklists.service');
const strict=(o,label)=>new Proxy(o,{get(t,k){if(typeof k==='symbol'||k==='then')return t[k];if(!(k in t))throw Error(`UNMOCKED ${label}.${k}`);return t[k];}});
const copy=structuredClone;
function matches(row,where={}){return Object.entries(where).every(([k,v])=>{
  if(v===undefined)return true;
  if(k==='AND')return (Array.isArray(v)?v:[v]).every(x=>matches(row,x));if(k==='OR')return v.some(x=>matches(row,x));
  if(v&&typeof v==='object'&&!(v instanceof Date))return Object.entries(v).every(([op,x])=>{
    if(op==='not')return row[k]!==x;if(op==='in')return x.includes(row[k]);if(op==='gte')return row[k]>=x;if(op==='lte')return row[k]<=x;if(op==='gt')return row[k]>x;if(op==='lt')return row[k]<x;
    throw Error(`UNSUPPORTED_WHERE ${k}.${op}`);
  });return row[k]===v;
});}
test('J06 J08 J23 J31 same Task lifecycle feeds actual Notifications board archive and Ops projection',async()=>{
  const actor={userId:'chain-operator',selectedFactoryId:'chain-factory',role:'TECH_MECHANIC',departmentId:'chain-department',isAdmin:false,isGuest:false,permissions:['tasks.read','tasks.take','tasks.done','notifications.read']};
  const tasks=[],notices=[],operations=[],audits=[],events=[],pushes=[],locks=[];
  const store={};const one=(rows,where)=>copy(rows.find(r=>matches(r,where))||null);
  const update=(rows,where,data)=>{let count=0;for(const row of rows.filter(r=>matches(r,where))){for(const[k,v]of Object.entries(data))row[k]=v&&typeof v==='object'&&'increment'in v?row[k]+v.increment:v;count++;}return{count};};
  store.$executeRaw=async(strings,...values)=>{assert.ok(strings.join('?').includes('pg_advisory_xact_lock'));locks.push(values);return 0;};
  store.$transaction=async fn=>fn(db); // Deliberately NOT rollback, lock or concurrent transaction emulation.
  store.processedOperation=strict({findUnique:async({where})=>copy(operations.find(p=>p.userId===where.userId_operationId.userId&&p.operationId===where.userId_operationId.operationId)||null),create:async({data})=>{operations.push(copy(data));return copy(data);}},'processedOperation');
  store.task=strict({
    create:async({data})=>{const row={...copy(data),id:'chain-task',version:0,deletedAt:null,startedAt:null,doneAt:null,comments:[],history:[],reads:[],departmentRecipients:[],assignees:data.assignees.create.map(a=>({...a,assignedAt:new Date()}))};tasks.push(row);return copy(row);},
    findFirst:async({where})=>one(tasks,where),findUnique:async({where})=>one(tasks,where),findMany:async({where,take})=>copy(tasks.filter(r=>matches(r,where)).slice(0,take)),updateMany:async({where,data})=>update(tasks,where,data),
  },'task');
  store.taskAssignee=strict({upsert:async({where,update:values,create})=>{const row=tasks.find(t=>t.id===where.taskId_userId.taskId);const existing=row.assignees.find(a=>a.userId===where.taskId_userId.userId);if(existing)Object.assign(existing,values);else row.assignees.push(copy(create));return copy(existing||create);}},'taskAssignee');
  store.taskHistory=strict({create:async({data})=>{const h={...copy(data),createdAt:new Date(process.env.ZAVOD_INTERNAL_TEST_NOW)};tasks.find(t=>t.id===data.taskId).history.push(h);return h;}},'taskHistory');
  store.taskComment=strict({create:async({data})=>{const c={...data,id:'chain-comment',createdAt:new Date(),deletedAt:null};tasks.find(t=>t.id===data.taskId).comments.push(c);return copy(c);}},'taskComment');
  store.taskSettings=strict({findUnique:async()=>({taskDoneRequiresComment:true,taskReadReceiptsEnabled:false})},'taskSettings');
  store.userFactoryAccess=strict({findMany:async({where})=>{assert.equal(where.factoryId,actor.selectedFactoryId);assert.deepEqual(where.userId.in,[actor.userId]);assert.equal(where.isActive,true);assert.equal(where.user.blockedAt,null);return[{userId:actor.userId,role:actor.role,department:{id:actor.departmentId,name:'Механики'}}];}},'access');
  store.notification=strict({findFirst:async({where})=>one(notices,where),findMany:async({where,take})=>copy(notices.filter(r=>matches(r,where)).slice(0,take)),create:async({data})=>{const n={...copy(data),id:`chain-notice-${notices.length+1}`,createdAt:new Date(),readAt:null};notices.push(n);return copy(n);},update:async({where,data})=>{update(notices,where,data);return one(notices,where);},updateMany:async({where,data})=>update(notices,where,data)},'notification');
  const db=strict(store,'db'),audit={write:async d=>audits.push(copy(d)),writeTx:async(_tx,d)=>audits.push(copy(d))};
  const ws=strict({broadcast:(...a)=>events.push(copy(a)),sendToUsers:(...a)=>events.push(copy(a))},'ws');
  const push=strict({sendPush:(...a)=>pushes.push(copy(a)),sendNotificationToUsers:async(...a)=>pushes.push(copy(a))},'push');
  const notifications=new NotificationsService({db},audit,ws,push,strict({resolveForFactory:async(userId,factoryId)=>{assert.equal(userId,actor.userId);return{...actor,selectedFactoryId:factoryId};}},'authority'));
  const service=new TaskService({db},ws,push,audit,strict({listForEntities:async()=>new Map()},'attachments'),notifications,strict({},'directory'));
  const previous={node:process.env.NODE_ENV,now:process.env.ZAVOD_INTERNAL_TEST_NOW};process.env.NODE_ENV='test';process.env.ZAVOD_INTERNAL_TEST_NOW='2026-09-15T05:00:00Z';
  try{
    await assert.rejects(service.createTask({actor,operationId:'create-invalid',description:''}),e=>e.getStatus?.()===409);assert.equal(tasks.length,0);
    const task=await service.createTask({actor,operationId:'chain-create',description:'Проверить датчик',assigneeUserIds:[actor.userId]});assert.equal(task.status,'NEW');assert.equal((await service.board(actor)).NEW[0].id,task.id);
    assert.equal((await notifications.list(actor))[0].entityId,task.id);assert.equal((await notifications.unreadCount(actor)).count,1);
    const createdEvents=events.length;await service.createTask({actor,operationId:'chain-create',description:'Проверить датчик',assigneeUserIds:[actor.userId]});assert.equal(tasks.length,1);assert.equal(events.length,createdEvents);assert.equal(notices.length,1);
    await notifications.markRead(actor,notices[0].id);assert.equal((await notifications.unreadCount(actor)).count,0);
    process.env.ZAVOD_INTERNAL_TEST_NOW='2026-09-15T05:10:00Z';await service.takeTask(task.id,actor,'chain-take');assert.equal((await service.board(actor)).IN_PROGRESS[0].id,task.id);const takenEvents=events.length;await service.takeTask(task.id,actor,'chain-take');assert.equal(events.length,takenEvents);
    await assert.rejects(service.completeTask(task.id,actor,'chain-done',''),e=>e.getStatus?.()===409);assert.equal(tasks[0].status,'IN_PROGRESS');
    process.env.ZAVOD_INTERNAL_TEST_NOW='2026-09-15T05:40:00Z';await service.completeTask(task.id,actor,'chain-done','Датчик проверен');assert.equal((await service.board(actor)).DONE[0].id,task.id);assert.equal((await service.detail(task.id,actor)).comments[0].message,'Датчик проверен');
    const notice=notices.find(n=>n.type==='TASK_DONE');assert.equal(notice.entityId,task.id);assert.equal(notice.factoryId,actor.selectedFactoryId);assert.equal((await notifications.unreadCount(actor)).count,1);
    const summary=await service.archiveSummary(actor,{dateFrom:'2026-09-15T00:00:00Z',dateTo:'2026-09-16T00:00:00Z'});assert.equal(summary.metrics.total,1);assert.equal(summary.metrics.closed,1);assert.equal(summary.items[0].id,task.id);assert.equal(summary.metrics.averageExecutionMinutes,30);
    const ops=new OpsService(strict({},'unused-prisma'),audit);const period=ops.resolveOperationsPeriod({dateFrom:'2026-09-15T00:00:00Z',dateTo:'2026-09-16T00:00:00Z'},new Date('2026-09-15T06:00:00Z'));const projection=ops.serializeOperationalTask(copy(tasks[0]),[],period);assert.equal(projection.id,task.id);assert.equal(projection.status,'DONE');assert.equal(projection.executionMinutes,summary.metrics.averageExecutionMinutes);assert.equal(projection.responseMinutes,10);
    await assert.rejects(service.detail(task.id,{...actor,selectedFactoryId:'other-factory'}),e=>e.getStatus?.()===409);await assert.rejects(notifications.markRead({...actor,permissions:['notifications.read']},notice.id),e=>e.getStatus?.()===403);
    assert.deepEqual(tasks[0].history.map(h=>h.action),['TASK_CREATED','TASK_TAKEN','TASK_DONE']);assert.equal(operations.length,3);assert.ok(locks.length>=5);assert.equal(notices.filter(n=>n.type==='TASK_DONE').length,1);
  }finally{if(previous.node===undefined)delete process.env.NODE_ENV;else process.env.NODE_ENV=previous.node;if(previous.now===undefined)delete process.env.ZAVOD_INTERNAL_TEST_NOW;else process.env.ZAVOD_INTERNAL_TEST_NOW=previous.now;}
});
test('J05 J23 J24 real Ops interval clipping aggregate and audit sanitizer',()=>{
  const ops=new OpsService(strict({},'unused-db'),strict({},'unused-audit'));
  const from=new Date('2026-09-15T05:00:00Z'),to=new Date('2026-09-15T09:00:00Z');const period={start:from,endExclusive:to,asOf:to,days:1};
  const event=(id,status,at)=>({id,status,lineId:'memory-line',line:{name:'Линия фасовки'},createdAt:new Date(at),comment:'Проверка узла'});
  const rows=[event('pause','PAUSE','2026-09-15T04:30:00Z'),event('work','WORK','2026-09-15T06:00:00Z'),event('stop','STOP','2026-09-15T07:30:00Z'),event('outside','PAUSE','2026-09-15T09:00:00Z')];
  const intervals=ops.buildDowntimeIntervals(rows,period,to);assert.equal(intervals.length,2);assert.equal(intervals.reduce((n,d)=>n+d.durationMinutes,0),150);assert.equal(intervals.find(d=>d.id==='stop').isOpen,false);
  const summary=ops.buildLineSummaries([{id:'memory-line',name:'Линия фасовки',status:'STOP'}],intervals,[],[],period)[0];assert.equal(summary.lostMinutes,150);assert.equal(summary.cleanWorkMinutes,90);assert.equal(summary.planCompletionPercent,null);
  const safe=ops.safeDetails({actorName:'Мастер смены',passwordHash:'ISOLATED_SENTINEL_A',nested:{token:'ISOLATED_SENTINEL_B',oldStatus:'NEW',newStatus:'DONE'}});assert.ok(!JSON.stringify(safe).includes('ISOLATED_SENTINEL'));assert.equal(safe.actorName,'Мастер смены');assert.equal(safe.nested.oldStatus,'NEW');
  assert.throws(()=>ops.assertOperationsScope({isGuest:true,isAdmin:false,role:'WORKER',permissions:[]},{}),e=>e.getStatus?.()===403);
});
test('J14 real immutable snapshot sanitizer is separate from ordinary comment text',()=>{
  const snapshot={schema:'zavod.shift-handover',version:1,comment:'Комментарий следующей смене',sections:{lines:[{id:'memory-line',title:'Линия фасовки',status:'WORK',statusLabel:'Работает',unexpected:'ISOLATED_SENTINEL'}],washes:[],tasks:[],people:[],defrosts:[],importantLogs:[]},counts:{total:99}};
  const encoded=handover.encodeShiftHandover(snapshot);snapshot.comment='Изменение после сохранения';const read=handover.parseShiftHandover(encoded);assert.equal(read.comment,'Комментарий следующей смене');assert.equal(read.counts.total,1);assert.ok(!encoded.includes('ISOLATED_SENTINEL'));
  assert.equal(handover.parseShiftHandover('Обычный комментарий к смене'),null);assert.equal(handover.parseShiftHandover(handover.SHIFT_HANDOVER_PREFIX+'{bad'),null);assert.ok(handover.handoverPlainText(read).includes('Комментарий следующей смене'));
});
test('J12 J13 actual typed checklist template and answer corpus incl required photo occurrence scope',async()=>{
  const empty=strict({},'unused-infrastructure');const service=new ChecklistsService(empty,empty,empty,empty,empty,empty);
  const row={id:'memory-row',title:'Контроль датчика',requiredAnswer:true,requiresPhoto:false,requiresComment:false,isRequired:true,minValue:0,maxValue:10,optionsJson:['Работает','Ремонт']};
  const cases=[['YES_NO',{answerBoolean:false},'ISSUE'],['YES_NO',{answerBoolean:true},'OK'],['YES_NO_NA',{selectedOption:'NA'},'NA'],['TEXT',{answerText:'Проверено'},'OK'],['REQUIRED_COMMENT',{comment:'Защита исправна'},'OK'],['NUMBER',{answerNumber:0},'OK'],['NUMBER',{answerNumber:10},'OK'],['NUMBER',{answerNumber:11},'ISSUE'],['SELECT',{selectedOption:'Работает'},'OK'],['PHOTO',{},'OK'],['INFO',{},'OK'],['LEGACY',{status:'NA'},'NA']];
  for(const[type,body,status]of cases){const answer=await service.normalizeRunRowAnswer(empty,{...row,rowType:type},body,null);assert.equal(answer.status,status);if(type==='NUMBER')assert.equal(answer.answerNumber,body.answerNumber);}
  for(const[type,body]of [['YES_NO',{}],['NUMBER',{}],['NUMBER',{answerNumber:'не число'}],['TEXT',{}],['SELECT',{selectedOption:'Чужой вариант'}]])await assert.rejects(service.normalizeRunRowAnswer(empty,{...row,rowType:type},body,null),e=>e.getStatus?.()===409);
  let count=0;const queries=[];const tx=strict({attachment:strict({count:async q=>{queries.push(q);return count;}},'attachment')},'photo-tx');
  await assert.rejects(service.normalizeRunRowAnswer(tx,{...row,rowType:'REQUIRED_PHOTO'}, {},'memory-occurrence-row'),e=>e.getStatus?.()===409);count=1;assert.equal((await service.normalizeRunRowAnswer(tx,{...row,rowType:'REQUIRED_PHOTO'}, {},'memory-occurrence-row')).status,'OK');
  assert.deepEqual(queries[1].where,{deletedAt:null,OR:[{entityType:'CHECKLIST_RUN_ROW',entityId:'memory-row'},{entityType:'CHECKLIST_ENTRY',entityId:'memory-occurrence-row'}]});
  assert.equal(service.normalizeTemplateRowInput({rowType:'NUMBER',minValue:0,maxValue:10,targetValue:0}).targetValue,0);
  assert.throws(()=>service.normalizeTemplateRowInput({rowType:'NUMBER',minValue:10,maxValue:0}),e=>e.getStatus?.()===409);assert.throws(()=>service.normalizeTemplateRowInput({rowType:'SELECT',options:[]}),e=>e.getStatus?.()===409);
  assert.equal(service.normalizeTemplateAssignment({frequencyRule:'TWICE_PER_SHIFT'}).frequencyIntervalValue,6);
  // No lifecycle/start/close scheduler or transaction acceptance from these private pure contracts.
});
