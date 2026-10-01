require('./master-offline-guard.cjs');require('reflect-metadata');
const {test}=require('node:test'),assert=require('node:assert/strict');
const {memory,strict,denied}=require('./master-r2-memory.cjs');
const {OrdersService}=require('../dist/modules/orders/orders.service');
function fixture(){
  const m=memory(),user={userId:'stock-actor',selectedFactoryId:'stock-factory',departmentId:'stock-dept',role:'STORE',isGuest:false,isAdmin:false,permissions:['orders.read','orders.restock']};
  const item={id:'stock-item',factoryId:user.selectedFactoryId,departmentId:user.departmentId,name:'Упаковка',currentQuantity:10,minThreshold:4,referenceQuantity:10,initialQuantity:10,unit:'шт',isActive:true,archivedAt:null},movements=[];
  m.data.minimumStockItem=m.model('minimumStockItem',[item],{includes:['movements','orderRequests'],enrich:r=>({...r,movements:movements.filter(x=>x.itemId===r.id),orderRequests:[]})});m.data.minimumStockMovement=m.model('minimumStockMovement',movements);
  m.data.department=m.model('department',[{id:user.departmentId,factoryId:user.selectedFactoryId,name:'Склад',scope:'FACTORY',deletedAt:null}]);
  m.data.orderSettings=strict({findUnique:async()=>({takeRequiresComment:true,restockRequiresComment:true,lowStockNotificationsEnabled:false})});
  const service=new OrdersService({db:m.db},m.attachments,m.audit,strict({}),m.ws),body={quantity:2,comment:'Использование упаковки',operationId:'stock-command'};
  return {...m,user,item,movements,service,body};
}
for(const action of ['take','restock'])for(const variant of ['archived-current-read','null-result','wrong-type','wrong-item','wrong-actor','foreign','department-revoked'])test(`R2-A/E-J18 stock ${action} replay ${variant}`,async()=>{
  const f=fixture();await f.service[action](f.user,f.item.id,f.body);const balance=f.item.currentQuantity;
  if(variant==='archived-current-read'){f.item.isActive=false;f.item.archivedAt=new Date();assert.equal((await f.service.item(f.user,f.item.id)).currentQuantity,balance);}
  if(variant==='null-result')f.operations[0].resultKey=null;if(variant==='wrong-type')f.movements[0].type=action==='take'?'RESTOCK':'TAKE';if(variant==='wrong-item')f.movements[0].itemId='other';if(variant==='wrong-actor')f.movements[0].actorId='other';if(variant==='foreign')f.user.selectedFactoryId='foreign';if(variant==='department-revoked')f.item.departmentId='other';
  const writes=f.writes.length;
  if(variant==='archived-current-read')assert.equal((await f.service[action](f.user,f.item.id,f.body)).currentQuantity,balance);else await assert.rejects(f.service[action](f.user,f.item.id,f.body),e=>{assert.ok(denied(e),e.stack);return true;});
  assert.equal(f.writes.length,writes);assert.equal(f.item.currentQuantity,balance);assert.equal(f.movements.length,1);
});
for(const action of ['take','restock'])for(const field of ['quantity','comment'])test(`R3-C2 stock ${action} replay denies changed ${field}`,async()=>{
 const f=fixture();await f.service[action](f.user,f.item.id,f.body);const writes=f.writes.length,balance=f.item.currentQuantity;
 await assert.rejects(f.service[action](f.user,f.item.id,{...f.body,[field]:field==='quantity'?3:'Другая операция'}),denied);
 assert.equal(f.writes.length,writes);assert.equal(f.item.currentQuantity,balance);assert.equal(f.movements.length,1);
});
