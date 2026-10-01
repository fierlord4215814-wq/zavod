require('./master-offline-guard.cjs');require('reflect-metadata');
const {test}=require('node:test'),assert=require('node:assert/strict');
const {memory,strict,copy,denied}=require('./master-r2-memory.cjs');
const {ChecklistsService}=require('../dist/modules/checklists/checklists.service');
function fixture(){
  const m=memory(),user={userId:'periodic-user',selectedFactoryId:'periodic-factory',departmentId:'periodic-dept',role:'MASTER',isAdmin:false,isGuest:false,permissions:['checklists.templates.manage','checklists.runs.self']};
  const department={id:user.departmentId,factoryId:user.selectedFactoryId,name:'Упаковка',scope:'FACTORY',isActive:true,deletedAt:null};
  const templates=[],templateRows=[],runs=[],rows=[],checks=[],entries=[],pauses=[],files=[];
  m.data.department=m.model('department',[department]);m.data.user=m.model('user',[{id:user.userId}]);m.data.line=m.model('line',[]);m.data.shiftSession=m.model('shiftSession',[]);m.data.attachment=m.model('attachment',files);
  m.data.checklistTemplate=m.model('checklistTemplate',templates,{includes:['rows','department'],enrich:r=>({...r,department,rows:templateRows.filter(x=>x.templateId===r.id)})});
  m.data.checklistTemplateRow=m.model('checklistTemplateRow',templateRows);
  m.data.checklistRunRow=m.model('checklistRunRow',rows,{defaults:{status:'PENDING',answerNumber:null,answerBoolean:null,answerText:null,selectedOption:null}});
  m.data.checklistRunCheckRow=m.model('checklistRunCheckRow',entries,{defaults:{status:'PENDING',answerNumber:null,answerBoolean:null},enrich:r=>({...r,check:checks.find(c=>c.id===r.checkId)})});
  const checkBase=m.model('checklistRunCheck',checks,{includes:['rows'],defaults:{status:'ACTIVE'},enrich:r=>({...r,rows:entries.filter(x=>x.checkId===r.id)})});
  m.data.checklistRunCheck=strict({...checkBase,create:async q=>{const {rows:nested,...data}=q.data;const check=await checkBase.create({...q,data});for(const row of nested?.create??[])await m.data.checklistRunCheckRow.create({data:{...row,checkId:check.id}});return check;}});
  m.data.checklistPauseEvent=m.model('checklistPauseEvent',pauses,{defaults:{pausedAt:new Date(),resumedAt:null}});
  const enrich=r=>({...r,template:{...templates.find(t=>t.id===r.templateId),department},rows:rows.filter(x=>x.runId===r.id),checks:checks.filter(x=>x.runId===r.id).map(c=>({...c,rows:entries.filter(e=>e.checkId===c.id)})),pauseEvents:pauses.filter(x=>x.runId===r.id)});
  const runBase=m.model('checklistRun',runs,{includes:['template','rows','checks','pauseEvents','user'],defaults:{status:'ACTIVE'},enrich});
  m.data.checklistRun=strict({...runBase,create:async q=>{const {rows:nested,...data}=q.data;const run=await runBase.create({...q,data});for(const row of nested?.create??[])await m.data.checklistRunRow.create({data:{...row,runId:run.id}});return run;}});
  m.data.checklistSettings=strict({findUnique:async()=>({requirePauseComment:true,allowEditAfterClose:false})});
  const service=new ChecklistsService({db:m.db},m.attachments,m.audit,strict({}),m.ws);
  const templateBody={name:'Проверка параметров упаковки',departmentId:department.id,frequencyRule:'EVERY_N_HOURS',frequencyIntervalUnit:'MINUTES',frequencyIntervalValue:1,rows:[{title:'Количество',rowType:'NUMBER',minValue:0,maxValue:10,requiredAnswer:true},{title:'Замечаний нет',rowType:'YES_NO',requiredAnswer:true},{title:'Фото защиты',rowType:'REQUIRED_PHOTO'}]};
  return {...m,user,department,templates,templateRows,runs,rows,checks,entries,pauses,files,service,templateBody};
}
async function started(){const f=fixture();const template=await f.service.createTemplate(f.user,f.templateBody);const run=await f.service.startRun(f.user,{templateId:template.id});return{...f,template,run};}
test('R2-A checklist missing processed result denies before changing a current answer',async()=>{
  const f=await started(),row=f.rows[0];f.operations.push({userId:f.user.userId,operationId:'missing-answer-result',resultKey:null});
  const writes=f.writes.length;await assert.rejects(f.service.completeRow(f.user,f.run.id,row.id,{answerNumber:7,checkId:f.run.currentCheck.id,operationId:'missing-answer-result'}),error=>{assert.ok(denied(error),error.stack);return true;});
  assert.equal(f.writes.length,writes);assert.equal(row.answerNumber,null);assert.equal(f.entries[0].answerNumber,null);
});
test('R2-E-J12 actual template run numeric0 false photo occurrence retry pause resume close archive identities',async()=>{
  const f=await started(),id=f.run.id,check=f.run.currentCheck.id;assert.equal(f.run.templateId,f.template.id);assert.equal(f.run.rows.length,3);assert.equal((await f.service.startRun(f.user,{templateId:f.template.id})).id,id);assert.equal(f.runs.length,1);
  const number=f.rows[0],boolean=f.rows[1],photo=f.rows[2];
  const before=f.writes.length;await assert.rejects(f.service.completeCurrentCheck(f.user,id,{checkId:check,operationId:'periodic-before-answers'}),denied);assert.equal(f.writes.length,before);
  await f.service.completeRow(f.user,id,number.id,{answerNumber:0,checkId:check,operationId:'periodic-zero'});await f.service.completeRow(f.user,id,boolean.id,{answerBoolean:false,checkId:check,operationId:'periodic-false'});
  const deniedWrites=f.writes.length;await assert.rejects(f.service.completeRow(f.user,id,photo.id,{checkId:check,operationId:'periodic-photo'}),denied);assert.equal(f.writes.length,deniedWrites);
  const photoEntry=f.entries.find(e=>e.runRowId===photo.id);f.files.push({id:'memory-photo',entityType:'CHECKLIST_ENTRY',entityId:photoEntry.id,deletedAt:null});
  await f.service.completeRow(f.user,id,photo.id,{checkId:check,operationId:'periodic-photo'});const ready=await f.service.run(f.user,id);assert.equal(ready.rows[0].answerNumber,0);assert.equal(ready.rows[1].answerBoolean,false);
  const result=await f.service.completeCurrentCheck(f.user,id,{checkId:check,operationId:'periodic-complete'});assert.notEqual(result.currentCheck.id,check);assert.equal(result.currentCheck.sequence,2);assert.equal(result.checks[0].rows[0].answerNumber,0);assert.equal(result.checks[0].rows[1].answerBoolean,false);assert.equal(result.rows[0].status,'PENDING');
  const writes=f.writes.length;await f.service.completeCurrentCheck(f.user,id,{checkId:check,operationId:'periodic-complete'});assert.equal(f.writes.length,writes);assert.equal(f.checks.length,2);
  await assert.rejects(f.service.completeRow(f.user,id,number.id,{answerNumber:7,checkId:check,operationId:'late-other-answer'}),denied);assert.equal(f.writes.length,writes);assert.equal(f.rows[0].answerNumber,null);assert.equal(f.entries.find(e=>e.checkId===check&&e.runRowId===number.id).answerNumber,0);
  await f.service.pause(f.user,id,{reason:'Осмотр'});assert.equal(f.runs[0].status,'PAUSED');await f.service.resume(f.user,id);assert.ok(f.pauses[0].resumedAt);await f.service.close(f.user,id,{reason:'Работа закончена'});
  const archive=(await f.service.runs(f.user,{closedOnly:'true'}))[0];assert.equal(archive.id,id);assert.equal(archive.templateId,f.template.id);assert.equal(archive.checks[0].id,check);assert.equal(archive.checks[0].rows[0].answerNumber,0);assert.equal(archive.checks[1].status,'CLOSED');
  await assert.rejects(f.service.run({...f.user,selectedFactoryId:'foreign'},id),denied);
});
for(const scenario of ['foreign','wrong-department','missing-capability','past-target'])test(`R2-E-J12 template/start negative ${scenario} no run mutation`,async()=>{
  const f=fixture(),template=await f.service.createTemplate(f.user,f.templateBody);let user={...f.user},body={templateId:template.id};
  if(scenario==='foreign')user.selectedFactoryId='foreign';if(scenario==='wrong-department')user.departmentId='foreign-dept';if(scenario==='missing-capability')user.permissions=[];if(scenario==='past-target')body={...body,shiftDate:'2020-01-01',shiftType:'DAY'};
  const writes=f.writes.length;await assert.rejects(f.service.startRun(user,body),error=>{assert.ok(denied(error),error.stack);return true;});assert.equal(f.runs.length,0);assert.equal(f.checks.length,0);assert.equal(f.writes.length,writes);
});
test('R2-E-J12 pure occurrence completion at explicit shift end does not create another occurrence',async()=>{
  const f=await started(),run=f.runs[0];f.entries.forEach(r=>r.status='OK');const end=new Date(run.shiftEndsAt);const result=await f.service.completePeriodicCheck(f.db,run,f.user,end,f.checks[0].id);assert.equal(result.checkId,f.checks[0].id);assert.equal(f.checks.length,1);assert.equal(run.status,'AUTO_CLOSED');assert.equal(run.closeKind,'SHIFT_END');assert.equal(run.nextCheckAt,null);
});
