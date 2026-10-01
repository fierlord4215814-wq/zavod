require('./master-offline-guard.cjs');
require('reflect-metadata');
const {test}=require('node:test'),assert=require('node:assert/strict');
const {OrdersService}=require('../dist/modules/orders/orders.service');
const {TaskService}=require('../dist/modules/task/task.service');
const {ShiftService}=require('../dist/modules/shift/shift.service');
const {ChecklistsService}=require('../dist/modules/checklists/checklists.service');
test('checklist workspace discloses pause form rule, not administrative settings',async()=>{
 const service=new ChecklistsService({db:{checklistRun:{findMany:async()=>[]}}},{},{},{},{});
 service.runMaintenance=async()=>{};service.ensureSettings=async()=>({requirePauseComment:false,privateValue:'not-public'});service.available=async()=>[];service.serializeRuns=async()=>[];
 const result=await service.workspace({userId:'reader',selectedFactoryId:'scope',permissions:[],isAdmin:false});
 assert.deepEqual(result.formSettings,{requirePauseComment:false});assert(!JSON.stringify(result).includes('not-public'));
});
test('self shift cancel capability is not the comment requirement; disabled permission stays denied',async()=>{
 for(const requireComment of [false,true])for(const allowed of [false,true]){
  // ADMIN02: the self read model now revalidates UFA and requires scoped
  // send-home provenance. OFF_SHIFT alone intentionally no longer grants return.
  const service=new ShiftService({db:{userFactoryAccess:{findUnique:async()=>({isActive:true,isGuest:false,user:{blockedAt:null,deletedAt:null}})},auditLog:{findFirst:async()=>null},shiftWillBe:{findFirst:async()=>({id:'own'})},shiftReturnRequest:{findFirst:async()=>null}}},{listPeople:async()=>[{userId:'self',employeeState:'OFF_SHIFT'}]},{},{},{},{});
  service.current=async()=>null;service.getShiftSettings=async()=>({willBeCancelRequiresComment:requireComment,sendHomeRequiresComment:true,returnRequestEnabled:true});
  const result=await service.me({userId:'self',selectedFactoryId:'scope',permissions:allowed?['shift.self.manage']:[]});
  assert.equal(result.allowedActions.canCancelWillBe,allowed);assert.deepEqual(result.formSettings,{willBeCancelRequiresComment:requireComment,sendHomeRequiresComment:true});assert.equal(result.allowedActions.canRequestReturn,false);
 }
});
test('task board includes only current form hints for non-admin readers, keeps four lanes',async()=>{
 const service=new TaskService({}, {}, {}, {}, {}, {});
 service.listTasks=async()=>[{id:'a',status:'NEW',type:'URGENT'},{id:'b',status:'NEW',type:'LONG'}];
 service.getTaskSettings=async()=>({longTaskDefaultDeadlineHours:7,longTaskEscalationEnabled:false,taskRedirectRequiresComment:false,taskDoneRequiresComment:true,taskReadReceiptsEnabled:true,privateValue:'not-public'});
 const result=await service.board({selectedFactoryId:'scope',isAdmin:false,permissions:['tasks.read']});
 assert.equal(result.NEW.length,1);assert.equal(result.LONG.length,1);assert.equal(result.DONE.length,0);
 assert.deepEqual(result.formSettings,{longTaskDefaultDeadlineHours:7,longTaskEscalationEnabled:false,taskRedirectRequiresComment:false,taskDoneRequiresComment:true,taskReadReceiptsEnabled:true});assert(!JSON.stringify(result).includes('not-public'));
});
test('order summary exposes only operational form hints, without requiring full settings read',async()=>{
 const service=new OrdersService({db:{minimumStockItem:{findMany:async()=>[]},orderRequest:{findMany:async()=>[]}}},{},{},{},{});
 service.ensureSettings=async()=>({id:'private-settings-id',factoryId:'scope',defaultUnit:'кг',takeRequiresComment:false,restockRequiresComment:true,archiveRequiresComment:false,retentionSecret:'must-not-leak'});
 const result=await service.summary({userId:'reader',selectedFactoryId:'scope',departmentId:null,role:'MASTER',isAdmin:false,isGuest:false,permissions:['orders.read']});
 assert.deepEqual(result.formSettings,{defaultUnit:'кг',takeRequiresComment:false,restockRequiresComment:true,archiveRequiresComment:false});
 assert(!JSON.stringify(result).includes('must-not-leak'));assert(!JSON.stringify(result).includes('private-settings-id'));assert.equal(result.itemsCount,0);
});
