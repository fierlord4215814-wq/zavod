// Explicit non-secret projections from the owned copy. No product aggregators are imported.
const select=s=>Object.fromEntries(s.split(' ').map(k=>[k,true]));
async function primary(p,fid){
 const specs={
 line:'id factoryId name status deletedAt deactivatedAt',
 task:'id factoryId lineId lineStatusEventId createdById assignedToId takenById doneById type description status deadlineAt startedAt doneAt createdAt updatedAt deletedAt operationId',
 okkRecord:'id factoryId lineId status description article productName shiftLabel defectQuantity createdAt completedAt archivedAt deletedAt',
 stockDefect:'id factoryId productName name quantity unit status comment createdAt deletedAt',
 returnRecord:'id factoryId lineId description article productName quantity unit status createdAt completedAt archivedAt deletedAt',
 checklistRun:'id factoryId departmentId templateId userId lineId shiftType status startedAt closedAt closeKind',
 washSession:'id factoryId lineId targetType objectName objectDescription startedById status createdAt completedAt deletedAt',
 minimumStockItem:'id factoryId departmentId name minThreshold initialQuantity currentQuantity unit isActive archivedAt createdAt',
 minimumStockMovement:'id factoryId itemId type quantity beforeQuantity afterQuantity createdAt',
 orderRequest:'id factoryId departmentId sourceItemId title description reasonComment status createdAt closedAt',
 shiftLog:'id factoryId departmentId title text isImportant status isDeleted createdAt',
 defrostEvent:'id factoryId lineId eventType status startAt endAt comment',
 lineShiftResult:'id factoryId lineId planCompletionPercent createdAt',
 notification:'id factoryId departmentId userId type title message entityType entityId readAt createdAt',
 };
 const out={};for(const[k,v]of Object.entries(specs))out[k]=await p[k].findMany({where:{factoryId:fid},select:select(v),orderBy:{id:'asc'}});
 out.lineEvent=await p.lineEvent.findMany({where:{line:{factoryId:fid}},select:select('id lineId factoryId createdById status comment downtimeReason confirmedEndAt correctedStartAt correctedEndAt createdAt'),orderBy:{id:'asc'}});
 out.taskHistory=await p.taskHistory.findMany({where:{task:{factoryId:fid}},select:select('id taskId action createdAt'),orderBy:{createdAt:'asc'}});
 out.taskDepartmentRecipient=await p.taskDepartmentRecipient.findMany({where:{task:{factoryId:fid}},select:select('id taskId departmentId active')});
 out.taskAssignee=await p.taskAssignee.findMany({where:{task:{factoryId:fid}},select:select('id taskId userId active')});
 out.department=await p.department.findMany({where:{OR:[{factoryId:fid},{scope:'GLOBAL'}]},select:select('id factoryId scope name isActive deletedAt')});
 out.template=await p.checklistTemplate.findMany({where:{runs:{some:{factoryId:fid}}},select:select('id name')});
 out.check=await p.checklistRunCheck.findMany({where:{run:{factoryId:fid}},select:select('id runId status dueAt startedAt completedAt')});
 out.washIssue=await p.washIssue.findMany({where:{session:{factoryId:fid}},select:select('id washSessionId title message status isResolved createdAt resolvedAt')});
 out.washControlItem=await p.washControlItem.findMany({where:{session:{factoryId:fid}},select:select('id washSessionId title description type status createdAt doneAt deletedAt')});
 out.accessDenied=await p.auditLog.findMany({where:{factoryId:fid,action:'ACCESS_DENIED'},select:select('id factoryId userId entityId createdAt')});
 return JSON.parse(JSON.stringify(out));
}
module.exports={primary};
