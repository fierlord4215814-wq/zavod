// Negative security contract; retain a FAIL if the current replay bypasses scope.
require('./master-offline-guard.cjs');require('reflect-metadata');
const {test}=require('node:test'),assert=require('node:assert/strict');
const {TaskService}=require('../dist/modules/task/task.service');
const {TaskController}=require('../dist/modules/task/task.controller');
const {Reflector}=require('@nestjs/core');const {PermissionGuard}=require('../dist/common/permission.guard');
const strict=(o,label)=>new Proxy(o,{get(t,k){if(typeof k==='symbol'||k==='then')return t[k];if(!(k in t))throw Error(`UNMOCKED ${label}.${k}`);return t[k];}});
test('MI-SEC-01 processed Task take replay must not return another selected factory entity',async()=>{
  const oldTask={id:'memory-task-A',factoryId:'memory-factory-A',deletedAt:null,createdById:'memory-user',description:'Объект первой площадки',status:'IN_PROGRESS',type:'URGENT',departmentRecipients:[],assignees:[],comments:[],reads:[],createdAt:new Date('2026-09-15T00:00:00Z')};
  const calls=[];
  // R2 compatibility: model the newly scoped query; the original negative assertion below is unchanged.
  const readTask=async q=>{calls.push(q);return Object.entries(q.where).every(([key,value])=>oldTask[key]===value)?structuredClone(oldTask):null;};
  const tx=strict({$executeRaw:async()=>0,processedOperation:strict({findUnique:async q=>{calls.push(q);return {userId:'memory-user',operationId:'memory-take-A',resultKey:oldTask.id};}},'processedOperation'),task:strict({findUnique:readTask,findFirst:readTask},'task')},'tx');
  const service=new TaskService({db:strict({$transaction:async fn=>fn(tx)},'db')},strict({},'ws'),strict({},'push'),strict({},'audit'),strict({},'attachments'),strict({},'notifications'),strict({},'directory'));
  const user={userId:'memory-user',selectedFactoryId:'memory-factory-B',departmentId:'memory-department-B',role:'TECH_MECHANIC',isAdmin:false,isGuest:false,permissions:['tasks.read','tasks.take']};
  const guard=new PermissionGuard(new Reflector(),{write:async()=>{}});
  assert.equal(await guard.canActivate({getClass:()=>TaskController,getHandler:()=>TaskController.prototype.takeTask,switchToHttp:()=>({getRequest:()=>({user,method:'POST',url:'/memory/tasks/take'})})}),true);
  let result,error;try{result=await new TaskController(service).takeTask(oldTask.id,{operationId:'memory-take-A'},user);}catch(e){error=e;}
  if(error)assert.ok([403,404,409].includes(error.getStatus?.()),'Unexpected infrastructure exception is not a valid denial');
  else assert.equal(result.factoryId,user.selectedFactoryId,'Processed replay returned memory-factory-A while current authorized context is memory-factory-B');
});
