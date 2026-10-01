// Independent reference arithmetic over explicit primary projections. No application code imports.
// Definition: Moscow calendar [from,to); time samples nearest-rank, each finished phase only.
const ms=x=>x==null?null:Date.parse(x),minute=(a,b)=>a==null||b==null||b<a?null:Math.round((b-a)/60000);
const sum=a=>a.reduce((s,n)=>s+n,0),mean=a=>a.length?Math.round(sum(a)/a.length):null;
const rank=(a,p)=>a.length?[...a].sort((x,y)=>x-y)[Math.ceil(a.length*p)-1]:null;
const hour=x=>new Date(x+10800000).getUTCHours(),shift=x=>hour(x)>=8&&hour(x)<20?'DAY':'NIGHT';
const ids=rows=>rows.map(x=>x.id),unit=x=>String(x||'без единицы').trim();
function calculate(d,q,asOf,actor){
 const start=ms(/^\d{4}-\d{2}-\d{2}$/.test(q.dateFrom)?q.dateFrom+'T00:00:00+03:00':q.dateFrom);
 const rawEnd=/^\d{4}-\d{2}-\d{2}$/.test(q.dateTo)?ms(q.dateTo+'T00:00:00+03:00')+86400000:ms(q.dateTo);
 const end=Math.min(rawEnd,start+93*86400000),cut=Math.min(ms(asOf),end),inside=x=>ms(x)!=null&&ms(x)>=start&&ms(x)<end;
 const byLine=x=>!q.lineId||x.lineId===q.lineId,byDept=x=>!q.departmentId||x.departmentId===q.departmentId,byShift=x=>!q.shiftType||q.shiftType==='all'||shift(ms(x))===q.shiftType;
 const out=[];
 function add(key,expected,rows,meaning,basis,formula,filters='selected factory; optional applicable line/department/shift',units='записи'){out.push({METRIC:key,USER_MEANING:meaning,SOURCE_ROWS:ids(rows),TIME_BASIS:basis,FILTERS:filters,FORMULA:formula,UNIT:units,EXPECTED:expected});}
 const lines=d.line.filter(x=>!x.deletedAt&&(!q.lineId||x.id===q.lineId));
 const events=d.lineEvent.filter(byLine);
 const intervals=[];
 for(const line of lines){
  const states=events.filter(e=>e.lineId===line.id).map(e=>({...e,at:ms(e.correctedStartAt??e.createdAt)})).sort((a,b)=>a.at-b.at||a.id.localeCompare(b.id));
  let usedUntil=start;
  for(let n=0;n<states.length;n++){
   const event=states[n];if(event.status==='WORK')continue;
   const transition=states.find((other,i)=>i>n&&other.at>event.at)?.at;
   const explicit=ms(event.correctedEndAt??event.confirmedEndAt);
   const actualEnd=Math.min(transition??Infinity,explicit??Infinity);
   let a=Math.max(start,event.at,usedUntil),b=Math.min(cut,actualEnd);if(b<=a)continue;
   usedUntil=b;
   // Slice against shift windows; preserve event identity even if it spans several windows.
   let duration=0;
   if(q.shiftType&&q.shiftType!=='all'){
    for(let day=Math.floor((a+10800000)/86400000)*86400000-10800000-86400000;day<b;day+=86400000){
     const windows=q.shiftType==='DAY'?[[day+8*3600000,day+20*3600000]]:[[day+20*3600000,day+32*3600000]];
     for(const [f,t]of windows)duration+=Math.max(0,Math.min(b,t)-Math.max(a,f));
    }
   }else duration=b-a;
   if(!duration)continue;
   intervals.push({id:event.id,lineId:line.id,minutes:Math.round(duration/60000),open:actualEnd>cut,start:a,end:b,reason:event.downtimeReason||'UNKNOWN',comment:event.comment});
  }
 }
 const taskRows=[];
 for(const t of d.task.filter(t=>!t.deletedAt&&byLine(t)&&ms(t.createdAt)<Math.min(end,cut+1)&&byShift(t.createdAt))){
  const history=d.taskHistory.filter(h=>h.taskId===t.id);
  const taken=ms(t.startedAt??history.find(h=>h.action==='TASK_TAKEN')?.createdAt),done=ms(t.doneAt??history.find(h=>h.action==='TASK_DONE')?.createdAt);
  if(done!=null&&done<start)continue;
  const recipients=d.taskDepartmentRecipient.filter(r=>r.taskId===t.id&&r.active);
  if(q.departmentId&&!recipients.some(r=>r.departmentId===q.departmentId))continue;
  if(q.taskType&&t.type!==q.taskType)continue;
  const status=done!=null&&done<=cut?'DONE':taken!=null&&taken<=cut?'IN_PROGRESS':'NEW';
  if(q.taskStatus&&q.taskStatus!==status)continue;
  const overdue=t.type==='LONG'&&t.deadlineAt!=null&&(status==='DONE'?done:cut)>ms(t.deadlineAt);
  const linked=intervals.some(i=>i.id===t.lineStatusEventId);
  const context=intervals.some(i=>i.lineId===t.lineId&&ms(t.createdAt)>=i.start&&ms(t.createdAt)<i.end);
  if(q.taskScope==='open'&&status==='DONE'||q.taskScope==='overdue'&&!overdue||q.taskScope==='downtimeLinked'&&!linked||q.taskScope==='downtimeContext'&&!linked&&!context||q.taskScope==='withoutDowntime'&&(linked||context))continue;
  taskRows.push({...t,status,recipients,overdue,linked,context,taken:taken!=null&&taken<=cut?taken:null,done:done!=null&&done<=cut?done:null});
 }
 const durations=intervals.map(i=>i.minutes),lost=sum(durations);
 add('summary.totalLostMinutes',lost,intervals,'Сумма STOP/PAUSE времени отдельных линий','пересечение периода до asOf','sum unique line-event clipped minutes',undefined,'машино-минуты');
 for(const[key,value,rows,meaning]of[
  ['downtimeCount',intervals.length,intervals,'Количество непустых интервалов простоя'],['openDowntimeCount',intervals.filter(x=>x.open).length,intervals.filter(x=>x.open),'Открытые простои на asOf'],
  ['tasksTotal',taskRows.length,taskRows,'Заявки, пересекающие период'],['tasksOpen',taskRows.filter(t=>t.status!=='DONE').length,taskRows.filter(t=>t.status!=='DONE'),'Открытые на asOf'],['tasksCompleted',taskRows.filter(t=>t.status==='DONE').length,taskRows.filter(t=>t.status==='DONE'),'Завершённые в выборке'],['urgentOpenTasks',taskRows.filter(t=>t.type==='URGENT'&&t.status!=='DONE').length,taskRows.filter(t=>t.type==='URGENT'&&t.status!=='DONE'),'Срочные открытые'],['overdueLongTasks',taskRows.filter(t=>t.overdue&&t.status!=='DONE').length,taskRows.filter(t=>t.overdue&&t.status!=='DONE'),'Открытые LONG за сроком']])add('summary.'+key,value,rows,meaning,'на asOf / пересечение периода','count distinct primary IDs');
 const samples={Downtime:durations,Response:taskRows.map(t=>minute(ms(t.createdAt),t.taken)).filter(x=>x!=null),Execution:taskRows.map(t=>minute(t.taken,t.done)).filter(x=>x!=null),Resolution:taskRows.map(t=>minute(ms(t.createdAt),t.done)).filter(x=>x!=null)};
 for(const[k,a]of Object.entries(samples))for(const[p,value]of[['average',mean(a)],['median',rank(a,.5)],['p90',rank(a,.9)]])add(`summary.${p}${k}Minutes`,value,k==='Downtime'?intervals:taskRows,`${p} ${k}; отсутствующее измерение исключено`,'завершённая фаза до asOf',p==='average'?'round(sum(samples)/N)':'sorted[ceil(N*p)-1] (nearest rank)',undefined,'минуты');
 let weekdays=0;for(let day=start;day<end;day+=86400000){const dow=new Date(day+10800000).getUTCDay();if(dow!==0&&dow!==6)weekdays++;}
 add('summary.tenMinuteDailyEffect.potentialMinutes',Math.min(lost,weekdays*10),intervals,'Условный потенциал, не деньги и не измеренная производительность','период','min(lost, 10*weekdays)',undefined,'минуты');
 for(const[status,key]of[['STOP','stop'],['PAUSE','pause'],['WORK','work']]){const a=events.filter(e=>e.status===status&&inside(e.correctedStartAt??e.createdAt)&&byShift(e.correctedStartAt??e.createdAt));add('lineEvents.'+key,a.length,a,'События '+status,'timestamp in [from,to)','count events');}
 add('lineEvents.downtimeLinkedTasks',taskRows.filter(t=>t.linked).length,taskRows.filter(t=>t.linked),'Заявки с точной связью event ID','выборка заявок','distinct task.lineStatusEventId in interval IDs');
 const quality={okkDefects:d.okkRecord.filter(x=>(!x.deletedAt||x.archivedAt)&&inside(x.createdAt)&&byLine(x)&&(!q.shiftType||q.shiftType==='all'||x.shiftLabel===(q.shiftType==='DAY'?'День':'Ночь'))),stockDefects:d.stockDefect.filter(x=>(!x.deletedAt||x.status==='ARCHIVED')&&inside(x.createdAt)),returns:d.returnRecord.filter(x=>(!x.deletedAt||x.archivedAt)&&inside(x.createdAt)&&byLine(x))};
 for(const[k,a]of Object.entries(quality))add('quality.'+k,a.length,a,'Число записей, архивирование не стирает исторический результат','создано в период','count primary IDs including canonical archive');
 const quantities={};for(const x of quality.stockDefects)quantities[unit(x.unit)]=(quantities[unit(x.unit)]??0)+x.quantity;
 add('quality.stockDefectQuantities',Object.entries(quantities).sort().map(([unit,quantity])=>({unit,quantity})),quality.stockDefects,'Текущее сохранённое количество в записях периода; не исторический снимок объёма','current quantity of period records','group by unit, sum each row once; no release ledger addition',undefined,'по единицам');
 const runs=d.checklistRun.filter(r=>byLine(r)&&byDept(r)&&(!q.shiftType||q.shiftType==='all'||r.shiftType===q.shiftType)),checks=d.check.filter(c=>runs.some(r=>r.id===c.runId));
 const closed=r=>inside(r.closedAt)&&['CLOSED','AUTO_CLOSED'].includes(r.status);
 const checklist={started:runs.filter(r=>inside(r.startedAt)),active:runs.filter(r=>ms(r.startedAt)<=cut&&(r.closedAt==null||ms(r.closedAt)>cut)),runsCompleted:runs.filter(closed),checksCompleted:checks.filter(c=>c.status==='COMPLETED'&&inside(c.completedAt)),checksOverdue:checks.filter(c=>inside(c.dueAt)&&ms(c.dueAt)<cut&&(c.completedAt==null||ms(c.completedAt)>cut)&&runs.some(r=>r.id===c.runId&&ms(r.startedAt)<=cut&&(r.closedAt==null||ms(r.closedAt)>cut))),manuallyClosed:runs.filter(r=>closed(r)&&(['MANUAL','MANUAL_EARLY'].includes(r.closeKind)||r.status==='CLOSED'&&!r.closeKind)),shiftClosed:runs.filter(r=>closed(r)&&(r.closeKind==='SHIFT_END'||r.status==='AUTO_CLOSED'))};
 for(const[k,a]of Object.entries(checklist))add('checklists.'+k,a.length,a,'Запуск / периодическая проверка: '+k,k==='active'||k==='checksOverdue'?'на asOf':'соответствующее событие в период','distinct parent/check IDs; closed-parent never current');
 const washes=d.washSession.filter(w=>!w.deletedAt&&byLine(w)&&ms(w.createdAt)<end&&(w.completedAt==null||ms(w.completedAt)>=start));
 const issues=d.washIssue.filter(i=>washes.some(w=>w.id===i.washSessionId)&&ms(i.createdAt)<=cut&&(inside(i.createdAt)||inside(i.resolvedAt)||i.resolvedAt==null||ms(i.resolvedAt)>cut));
 const mini=d.washControlItem.filter(i=>!i.deletedAt&&i.type==='MINI_TASK'&&washes.some(w=>w.id===i.washSessionId)&&ms(i.createdAt)<=cut&&(inside(i.createdAt)||inside(i.doneAt)||i.doneAt==null||ms(i.doneAt)>cut));
 const wash={active:washes.filter(w=>ms(w.createdAt)<=cut&&(w.completedAt==null||ms(w.completedAt)>cut)),completed:washes.filter(w=>inside(w.completedAt)),issues,openIssues:issues.filter(i=>i.resolvedAt==null||ms(i.resolvedAt)>cut),miniTasks:mini,miniTasksDone:mini.filter(i=>inside(i.doneAt))};
 for(const[k,a]of Object.entries(wash))add('wash.'+k,a.length,a,'Родители/проблемы/мини-задания отдельно: '+k,['active','openIssues'].includes(k)?'на asOf':'пересечение/событие периода','count unique primary IDs');
 // Summary table fields, not another aggregate source. Each row links exact primitive IDs.
 for(const line of lines){const a=intervals.filter(i=>i.lineId===line.id),tasks=taskRows.filter(t=>t.lineId===line.id),plans=d.lineShiftResult.filter(r=>r.lineId===line.id&&inside(r.createdAt)&&r.planCompletionPercent!=null);if(!a.length&&!tasks.some(t=>t.status!=='DONE')&&!plans.length)continue;for(const[k,v]of Object.entries({lostMinutes:sum(a.map(i=>i.minutes)),downtimeCount:a.length,openTasks:tasks.filter(t=>t.status!=='DONE').length,downtimeSharePercent:Math.round(sum(a.map(i=>i.minutes))/Math.max(1,Math.round((cut-start)/60000))*1000)/10,planCompletionPercent:mean(plans.map(r=>r.planCompletionPercent))}))add(`lines[${line.id}].${k}`,v,[...a,...tasks,...plans],line.name+' / '+k,'период / asOf','sum/count/mean from primary rows');}
 for(const dept of d.department){const tasks=taskRows.filter(t=>t.recipients.some(r=>r.departmentId===dept.id));if(!tasks.length)continue;const done=tasks.filter(t=>t.status==='DONE'),responses=tasks.map(t=>minute(ms(t.createdAt),t.taken)).filter(x=>x!=null);for(const[k,v]of Object.entries({received:tasks.length,closed:done.length,open:tasks.length-done.length,averageResponseMinutes:mean(responses),maxResponseMinutes:responses.length?Math.max(...responses):null,onTimePercent:done.length?Math.round(done.filter(t=>!t.overdue).length/done.length*100):null}))add(`departments[${dept.id}].${k}`,v,tasks,dept.name+' / '+k,'task selection; completed denominator for on-time','distinct task IDs; on-time DONE / all DONE');}
 return{start:new Date(start).toISOString(),end:new Date(end).toISOString(),asOf:new Date(cut).toISOString(),rows:out,intervals,taskIds:ids(taskRows),notes:['Accepted nearest-rank p50 is lower central value for even N, not interpolated median.','Checklist COMPLETED occurrence differs from manually CLOSED run/check; no row-count inflation.','No product aggregator or time/visibility helper imports. Known primary set must be separately checked for fixture eligibility.']};
}
function actualAt(a,key){if(key.startsWith('lines[')||key.startsWith('departments[')){const m=key.match(/^(\w+)\[([^\]]+)\]\.(.+)$/);return a[m[1]].find(r=>(r.lineId??r.departmentId)===m[2])?.[m[3]];}return key.split('.').reduce((v,k)=>v?.[k],a);}
function compare(calc,actual){return calc.rows.map(row=>({...row,API_ACTUAL:actualAt(actual,row.METRIC)??null,UI_ACTUAL:'PENDING_PAIRED_UI',STATUS:JSON.stringify(row.EXPECTED)===JSON.stringify(actualAt(actual,row.METRIC)??null)?'PASS_SQL_HTTP':'FAIL_SQL_HTTP'}));}
function counters(d,q,actor){
 const start=ms(q.dateFrom+'T00:00:00+03:00'),end=ms(q.dateTo+'T00:00:00+03:00')+86400000,inside=x=>ms(x)!=null&&ms(x)>=start&&ms(x)<end,now=ms(actor.asOf),period=r=>inside(r.createdAt),dept=r=>!q.departmentId||r.departmentId===q.departmentId;
 const notices=d.notification.filter(n=>n.factoryId===actor.factoryId&&(actor.role==='ADMIN'||n.userId===actor.id||!n.userId&&(!n.departmentId||n.departmentId===actor.departmentId)));
 const activeTasks=d.task.filter(t=>!t.deletedAt&&t.status!=='DONE'),washes=d.washSession.filter(w=>!w.deletedAt&&w.status!=='DONE');
 const overview={activeTasksCount:activeTasks,overdueLongTasksCount:activeTasks.filter(t=>t.type==='LONG'&&t.deadlineAt&&ms(t.deadlineAt)<now),activeWashCount:washes,washIssuesCount:d.washIssue.filter(i=>i.status!=='RESOLVED'&&washes.some(w=>w.id===i.washSessionId)),lowStockItemsCount:d.minimumStockItem.filter(i=>i.isActive&&!i.archivedAt&&i.currentQuantity<=i.minThreshold),openOrderRequestsCount:d.orderRequest.filter(i=>i.status==='ACTIVE'),activeImportantShiftLogsCount:d.shiftLog.filter(l=>!l.isDeleted&&l.isImportant&&l.status==='ACTIVE'),unreadNotificationsCount:notices.filter(n=>!n.readAt),checklistAutoClosedCount:d.checklistRun.filter(r=>r.status==='AUTO_CLOSED'&&inside(r.closedAt)&&dept(r)),recentAccessDeniedCount:d.accessDenied.filter(period)};
 const modules={Tasks:d.task.filter(t=>!t.deletedAt&&period(t)),Wash:d.washSession.filter(w=>!w.deletedAt&&period(w)),Checklists:d.checklistRun.filter(r=>inside(r.startedAt)&&dept(r)),Orders:d.orderRequest.filter(period),OKK:d.okkRecord.filter(r=>(!r.deletedAt||r.archivedAt)&&period(r)),Stock:d.stockDefect.filter(r=>(!r.deletedAt||r.status==='ARCHIVED')&&period(r)),Returns:d.returnRecord.filter(r=>(!r.deletedAt||r.archivedAt)&&period(r)),ShiftLog:d.shiftLog.filter(r=>!r.isDeleted&&period(r)&&dept(r)),Defrost:d.defrostEvent.filter(r=>r.eventType==='DEFROST'&&inside(r.startAt)),Notifications:notices.filter(period),'Auth/access':d.accessDenied.filter(period)};
 return{overview,modules};
}
module.exports={calculate,compare,actualAt,rank,mean,counters};
