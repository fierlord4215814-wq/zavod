require('./master-offline-guard.cjs');require('reflect-metadata');
const {test}=require('node:test'),assert=require('node:assert/strict');
const {memory}=require('./master-r2-memory.cjs');
const {StockService}=require('../dist/modules/stock/stock.service');
const {ReturnsService}=require('../dist/modules/returns/returns.service');
const {WsService}=require('../dist/ws/ws.service');
const {AttachmentsService}=require('../dist/modules/attachments/attachments.service');
const actor={userId:'own',selectedFactoryId:'A',isAdmin:true,permissions:[]};
test('OKK attachment uses the existing opaque factory/capability-scoped event',()=>{
 const events=[],s=Object.create(AttachmentsService.prototype);s.wsService={broadcast:(type,payload)=>events.push({type,payload})};
 s.broadcastQualityAttachment('A','OKK_RECORD');s.broadcastQualityAttachment(null,'OKK_RECORD');s.broadcastQualityAttachment('A','TASK');
 assert.deepEqual(events,[{type:'okk_updated',payload:{factoryId:'A'}}]);
 const ws=new WsService({}),received=[];for(const [id,factory,codes]of[['allowed','A',['okk.read']],['denied','A',[]],['foreign','B',['okk.read']]])ws.clients.set({readyState:1,send:v=>received.push({id,event:JSON.parse(v)})},{userId:id,factoryId:factory,isAdmin:false,permissions:new Set(codes)});
 ws.broadcast('okk_updated',{factoryId:'A',attachmentId:'must-not-leak'});assert.deepEqual(received.map(x=>x.id),['allowed']);assert.deepEqual(Object.keys(received[0].event.payload),['changedAt']);
});
for(const [name,event,cap]of [['stock','stock_updated','stock.read'],['returns','returns_updated','returns.publication.read']]){
 test(`${name} invalidation is opaque and current factory/capability scoped`,()=>{const service=new WsService({}),received=[];for(const [id,factory,isAdmin,codes]of [['allowed','A',false,[cap]],['denied','A',false,[]],['foreign','B',false,[cap]],['admin','A',true,[]]])service.clients.set({readyState:1,send:value=>received.push({id,event:JSON.parse(value)})},{userId:id,factoryId:factory,isAdmin,permissions:new Set(codes)});service.broadcast(event,{factoryId:'A',id:'must-not-leak',secret:'must-not-leak'});assert.deepEqual(received.map(x=>x.id),['allowed','admin']);for(const r of received)assert.deepEqual(Object.keys(r.event.payload),['changedAt']);});
 test(`${name} create commit emits once, processed retry emits nothing, rollback emits nothing`,async()=>{
  const m=memory(),rows=[];m.data[name==='stock'?'stockDefect':'returnRecord']=m.model(name,rows);let committed=false;const events=[];
  const db=new Proxy(m.db,{get(target,key){if(key==='$transaction')return async fn=>{const r=await target.$transaction(fn);committed=true;return r;};return target[key];}});
  const ws={broadcast:(event,payload)=>{assert.equal(committed,true);events.push({event,payload});}};
  const service=name==='stock'?new StockService({db},m.attachments,m.audit,ws):new ReturnsService({db},m.attachments,m.audit,{},ws);
  const input=name==='stock'?{name:'Учебная упаковка',quantity:2,operationId:'q'}:{description:'Учебная упаковка',photoUrl:'attachment-pending',operationId:'q'};
  const create=body=>name==='stock'?service.createDefect(actor,body):service.createReturn(actor,body);
  const one=await create(input);await create(input);assert.equal(rows.length,1);assert.equal(events.length,1);assert.equal(events[0].event,event);assert.equal(one.id,rows[0].id);
  const failDb={$transaction:async()=>{throw Error('rollback witness');}};
  const failed=name==='stock'?new StockService({db:failDb},m.attachments,m.audit,ws):new ReturnsService({db:failDb},m.attachments,m.audit,{},ws);
  await assert.rejects(name==='stock'?failed.createDefect(actor,input):failed.createReturn(actor,input),/rollback witness/);assert.equal(events.length,1);
 });
}
