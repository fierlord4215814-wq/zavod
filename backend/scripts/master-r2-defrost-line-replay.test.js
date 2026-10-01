require('./master-offline-guard.cjs');require('reflect-metadata');
const {test}=require('node:test'),assert=require('node:assert/strict');
const {memory,strict,denied}=require('./master-r2-memory.cjs');
const {DefrostService}=require('../dist/modules/defrost/defrost.service');
const {LineService}=require('../dist/modules/line/line.service');
const {StaffingControlPolicyService}=require('../dist/modules/line/staffing-control-policy.service');
for(const action of ['start','end','completeToday','markShockChamberBlown'])for(const variant of ['completed-visible','null-result','foreign','wrong-line','wrong-type','wrong-actor',...(action==='end'?['wrong-requested-event']:[])])test(`R2-A Defrost ${action} replay ${variant}`,async()=>{
  const m=memory(),user={userId:'cold-actor',selectedFactoryId:'cold-factory',role:'TECH_HOLOD',isAdmin:false,isGuest:false,permissions:['defrost.read','defrost.manage']};
  const row={id:'cold-event',factoryId:user.selectedFactoryId,lineId:'cold-line',startedById:user.userId,endedById:user.userId,eventType:action==='markShockChamberBlown'?'SHOCK_CHAMBER_BLOWN':'DEFROST',startAt:new Date(),endAt:new Date(),durationSeconds:0,status:'COMPLETED'};
  const rows=[row];m.data.defrostEvent=m.model('defrostEvent',rows,{includes:['line','startedBy','endedBy']});m.data.defrostSettings=strict({findUnique:async()=>({defrostCommentRequiredOnStart:true,defrostCommentRequiredOnEnd:true})});
  m.operations.push({userId:user.userId,operationId:'cold-repeat',resultKey:row.id});
  if(variant==='null-result')m.operations[0].resultKey=null;if(variant==='foreign')user.selectedFactoryId='foreign';if(variant==='wrong-line')row.lineId='other-line';if(variant==='wrong-type')row.eventType='OTHER';if(variant==='wrong-actor'){row.startedById='other';row.endedById='other';}if(variant==='wrong-requested-event'){rows.push({...row,id:'other-event'});m.operations[0].resultKey='other-event';}
  const service=new DefrostService({db:m.db},m.audit,strict({notifyDefrost:async()=>{}}),m.ws,strict({})),body={lineId:'cold-line',comment:'Завершённое действие',operationId:'cold-repeat'};
  const call=()=>action==='start'?service.start(user,body):action==='end'?service.end(user,row.id,body):service[action](user,'cold-line',body);
  // end has no requested line in its endpoint; its scoped current event owns that line.
  if(variant==='completed-visible'||(variant==='wrong-line'&&action==='end')){const result=await call();assert.equal((result.event??result).id,row.id);}else await assert.rejects(call(),e=>{assert.ok(denied(e),e.stack);return true;});
  assert.equal(m.writes.length,0);assert.equal(m.audits.length,0);
});
for(const action of ['activateTemplate','activateForShift'])for(const variant of ['current-readable','null-result','foreign-state','wrong-line','deleted-line'])test(`R2-A Line ${action} result ${variant}`,async()=>{
  const m=memory(),user={userId:'line-actor',selectedFactoryId:'line-factory',role:'ADMIN',isAdmin:true,isGuest:false,permissions:['lines.manage','shift.current.manage']};
  const line={id:'line-result-parent',factoryId:user.selectedFactoryId,deletedAt:variant==='deleted-line'?new Date():null,deactivatedAt:null,status:'STOP'};
  const state={id:'line-result',factoryId:variant==='foreign-state'?'foreign':user.selectedFactoryId,lineId:variant==='wrong-line'?'other':line.id};
  m.data.line=m.model('line',[line]);m.data.lineShiftState=m.model('lineShiftState',[state]);m.operations.push({userId:user.userId,operationId:'line-activation',resultKey:variant==='null-result'?null:state.id});
  const service=new LineService({db:m.db},m.ws,m.audit,new StaffingControlPolicyService({db:m.db})),call=()=>service[action](user,line.id,{operationId:'line-activation'});
  if(variant==='current-readable')assert.equal((await call()).id,state.id);else await assert.rejects(call(),e=>{assert.ok(denied(e),e.stack);return true;});assert.equal(m.writes.length,0);
});
