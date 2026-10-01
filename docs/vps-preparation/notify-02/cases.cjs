const l=require('./live.cjs'),users=require('../factory-01/users.json').users;
const keys=['request-department','request-factory','low-stock','request-close','task-done','task-redirect','task-escalated'];
const events={'request-department':'ORDER_REQUEST_CREATED','request-factory':'ORDER_REQUEST_CREATED','low-stock':'ORDER_STOCK_BELOW_THRESHOLD','request-close':'ORDER_REQUEST_CLOSED','task-done':'TASK_DONE','task-redirect':'TASK_REDIRECTED','task-escalated':'TASK_LONG_ESCALATED'};
const user=k=>users.find(u=>u.key===k);
async function makeCase(actors,key,label){const{a,m,t,e}=actors,event=events[key],operationId='notify02-'+label,description='Учебная проверка уведомлений '+label;let actor=a,id,call,body,path,expectedRows,sourceType;
 if(key.startsWith('request-')&&key!=='request-close'){body={title:description,departmentId:key==='request-factory'?null:t.me.departmentId,unit:'шт',reasonComment:'Проверка долговечности',operationId};path='/orders/requests';expectedRows=key==='request-factory'?1:2;sourceType='ORDER_REQUEST';}
 else if(key==='low-stock'){const r=await l.api(a.page,'POST','/orders/items',{name:description,departmentId:null,unit:'шт',initialQuantity:10,minThreshold:7});l.assert.equal(r.status,201);id=r.body.id;body={quantity:3,comment:'Проверка порога',operationId};path=`/orders/items/${id}/take`;expectedRows=2;sourceType='MINIMUM_STOCK_ITEM';}
 else if(key==='request-close'){const r=await l.api(a.page,'POST','/orders/requests',{title:description,departmentId:user('MANAGEMENT').access.departmentId,unit:'шт',reasonComment:'Проверка закрытия',operationId:operationId+'-setup'});l.assert.equal(r.status,201);id=r.body.id;body={closeStatus:'ORDERED',comment:'Проверка закрытия'};path=`/orders/requests/${id}/close`;expectedRows=2;sourceType='ORDER_REQUEST';}
 else{actor=m;const r=await l.api(m.page,'POST','/tasks',{type:key==='task-escalated'?'LONG':'URGENT',description,assigneeUserIds:[t.me.userId],operationId:operationId+'-setup',...(key==='task-escalated'?{deadlineAt:new Date(Date.now()-86400000).toISOString()}:{})});l.assert.equal(r.status,201);id=r.body.id;sourceType='TASK';
  if(key==='task-done'){body={operationId,comment:'Проверка закрытия'};path=`/tasks/${id}/complete`;expectedRows=1;}
  if(key==='task-redirect'){body={operationId,newDepartmentRecipientIds:[e.me.departmentId],newAssigneeUserIds:[e.me.userId],comment:'Проверка передачи'};path=`/tasks/${id}/redirect`;expectedRows=3;}
  if(key==='task-escalated'){body={};path='/tasks/escalation/check';expectedRows=3;}
 }
 call=()=>l.api(actor.page,'POST',path,body);
 const c={key,event,id,operationId:['request-close','task-escalated'].includes(key)?null:operationId,actor,body,path,call,expectedRows,description,sourceType,
  async discover(p){if(!c.id){const op=await p.processedOperation.findUnique({where:{userId_operationId:{userId:actor.me.userId,operationId}}});if(op)c.id=op.resultKey;}return c.id;},
  async state(p){await c.discover(p);return c.id?l.eventState(p,event,c.id,c.operationId,actor.me.userId):null;},
  async close(){if(!c.id)return;if(sourceType==='TASK')await l.done(m,c.id);else if(sourceType==='ORDER_REQUEST')await l.closeOrder(a,c.id);else l.assert.equal((await l.api(a.page,'POST',`/orders/items/${c.id}/archive`,{comment:'Учебная проверка закончена'})).status,201);}};
 return c;
}
function stable(s){if(!s)return s;return{...s,notifications:s.notifications.map(({readAt,...n})=>n),allNotifications:s.allNotifications.map(({readAt,...n})=>n)};}
async function actors(b){return{a:await l.login(b,'ADMIN'),m:await l.login(b,'MASTER'),t:await l.login(b,'TECH_KIPIA',390),e:await l.login(b,'TECH_ELECTRIC',390)};}
module.exports={...l,keys,events,user,makeCase,stable,actors};
