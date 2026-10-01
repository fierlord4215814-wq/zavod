// Explicitly authorized historical timestamps ONLY in OPS01 copy. This is NOT UI lifecycle proof.
const h=require('./live.cjs'),{randomUUID}=require('node:crypto');
const at=s=>new Date(s+'+03:00'),tag='Учебная аналитика OPS01';
(async()=>{const p=h.prisma(),ev={status:'IN_PROGRESS',classification:'CONTROLLED_SQL_TIMESTAMP_FIXTURES_NOT_UI',created:[]};try{await h.identity(p);h.assert(!h.fs.existsSync(h.path.join(__dirname,'controlled-fixtures.json')),'Exclusive fixture ledger exists');const base=require('./history-before.json').primary;const lines=base.line.map(l=>l.id),author=base.task[0].createdById,technician=base.task[0].takenById,departments=base.department.filter(d=>d.scope==='LOCAL').slice(0,2).map(d=>d.id);const template=base.checklistRun[0];ev.lines=lines;ev.departments=departments;
await p.$transaction(async tx=>{
 async function save(model,data,label){const r=await tx[model].create({data});ev.created.push({model,id:r.id,label});return r;}
 for(const[line,start,end,status,reason,label]of[
  [0,'2026-08-31T07:50:00','2026-08-31T08:10:00','STOP','TECHNICAL','07:50–08:10'],
  [0,'2026-08-31T09:00:00','2026-08-31T10:00:00','STOP','TECHNICAL','overlap-a'],
  [0,'2026-08-31T09:30:00','2026-08-31T10:30:00','PAUSE','QUALITY','overlap-b'],
  [0,'2026-08-31T19:50:00','2026-09-01T08:10:00','STOP','PEOPLE','month-night-crossing'],
  [1,'2026-08-31T08:00:00','2026-08-31T08:20:00','STOP','OTHER','simultaneous-other-line'],
  [1,'2026-08-31T09:00:00','2026-08-31T09:00:00','PAUSE','OTHER','zero-length'],
  [1,'2026-08-31T20:00:00','2026-08-31T20:01:00','STOP','TECHNICAL','exact-20'],
  [1,'2026-09-01T00:00:00','2026-09-01T00:02:00','STOP','TECHNICAL','exact-next-month'],
 ])await save('lineEvent',{factoryId:h.fid,lineId:lines[line],createdById:author,status,downtimeReason:reason,comment:tag+' '+label,createdAt:at(start),confirmedEndAt:at(end)},label);
 const created=at('2026-08-31T08:00:00');
 for(const [n,response]of[1,2,3,4,100,2,2].entries()){
  const taken=new Date(+created+response*60000),done=new Date(+taken+(n+1)*60000),task=await save('task',{factoryId:h.fid,lineId:lines[2],createdById:author,takenById:technician,doneById:technician,type:'LONG',description:tag+' время '+n,status:'DONE',createdAt:created,startedAt:taken,doneAt:done,deadlineAt:at('2026-09-02T00:00:00'),operationId:randomUUID()},'timing-'+n);
  for(const dep of departments)await save('taskDepartmentRecipient',{taskId:task.id,departmentId:dep,factoryId:h.fid},'two-recipient-'+n);
  for(const[action,when]of[['TASK_CREATED',created],['TASK_TAKEN',taken],['TASK_DONE',done],['TASK_REDIRECTED',new Date(+taken+1000)]])await save('taskHistory',{taskId:task.id,actorId:author,action,createdAt:when},'history-'+n);
 }
 // DONE now, but still NEW and overdue on the historical asOf. No live unfinished task.
 const later=await save('task',{factoryId:h.fid,lineId:lines[2],createdById:author,takenById:technician,doneById:technician,type:'LONG',description:tag+' взята позже выбранного периода',status:'DONE',createdAt:at('2026-08-31T08:00:00'),startedAt:at('2026-09-01T10:00:00'),doneAt:at('2026-09-01T11:00:00'),deadlineAt:at('2026-08-31T09:00:00'),operationId:randomUUID()},'historical-open-overdue');
 await save('taskDepartmentRecipient',{taskId:later.id,departmentId:departments[0],factoryId:h.fid},'later-recipient');
 const lateDone=await save('task',{factoryId:h.fid,lineId:lines[3],createdById:author,type:'LONG',description:tag+' завершена с опозданием',status:'DONE',createdAt:at('2026-08-31T07:00:00'),startedAt:at('2026-08-31T08:00:00'),doneAt:at('2026-08-31T10:00:00'),deadlineAt:at('2026-08-31T09:00:00'),operationId:randomUUID()},'completed-overdue-not-open');
 await save('taskDepartmentRecipient',{taskId:lateDone.id,departmentId:departments[1],factoryId:h.fid},'late-done-recipient');
 for(const[n,close,checkStatus,completed]of[[0,'2026-08-31T12:00:00','ACTIVE',null],[1,'2026-09-01T12:00:00','COMPLETED','2026-09-01T11:00:00'],[2,'2026-08-31T20:00:00','COMPLETED','2026-08-31T19:00:00']]){
  const run=await save('checklistRun',{factoryId:h.fid,departmentId:template.departmentId,templateId:template.templateId,userId:template.userId,lineId:lines[0],shiftType:'DAY',status:n===2?'AUTO_CLOSED':'CLOSED',startedAt:at('2026-08-31T07:00:00'),closedAt:at(close),closeKind:n===2?'SHIFT_END_COMPLETE':'MANUAL'},'run-'+n);
  await save('checklistRunCheck',{runId:run.id,sequence:1,status:checkStatus,startedAt:at('2026-08-31T07:00:00'),dueAt:at('2026-08-31T08:00:00'),completedAt:completed?at(completed):null},'check-'+n);
 }
 const wash=await save('washSession',{factoryId:h.fid,lineId:lines[0],startedById:author,status:'DONE',createdAt:at('2026-08-30T19:00:00'),completedAt:at('2026-09-01T09:00:00')},'wash-overlap');
 await save('washIssue',{factoryId:h.fid,washSessionId:wash.id,createdById:author,message:tag+' замечание',status:'RESOLVED',isResolved:true,createdAt:at('2026-08-30T20:00:00'),resolvedAt:at('2026-09-01T08:00:00')},'issue-open-asof');
 await save('washControlItem',{factoryId:h.fid,washSessionId:wash.id,createdById:author,title:tag+' контроль',type:'MINI_TASK',status:'DONE',createdAt:at('2026-08-30T20:00:00'),doneAt:at('2026-09-01T08:00:00')},'mini-open-asof');
 for(const[quantity,unit]of[[2,'кг'],[3,'шт']])await save('stockDefect',{factoryId:h.fid,createdById:author,productName:tag+' '+unit,name:tag+' '+unit,quantity,unit,createdAt:at('2026-08-31T08:00:00')},'units-'+unit);
}, {timeout:30000});
ev.status='CREATED_OWN_COPY_ONLY';h.receipt('controlled-fixtures',ev);console.log(JSON.stringify({status:ev.status,created:ev.created.length,models:[...new Set(ev.created.map(x=>x.model))]}));
}catch(e){ev.error=h.safeError(e);h.receipt('controlled-fixtures-failure',ev);throw e;}finally{await p.$disconnect();}})().catch(e=>{console.error(h.safeError(e));process.exitCode=1;});
