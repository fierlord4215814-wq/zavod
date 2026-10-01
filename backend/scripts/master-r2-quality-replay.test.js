require('./master-offline-guard.cjs');require('reflect-metadata');
const {test}=require('node:test'),assert=require('node:assert/strict');
const {memory,strict,denied}=require('./master-r2-memory.cjs');
const {OkkService}=require('../dist/modules/okk/okk.service');
const {ReturnsService}=require('../dist/modules/returns/returns.service');
const {StockService}=require('../dist/modules/stock/stock.service');
const {ErrorReportService}=require('../dist/modules/error-report/error-report.service');
const owners=[['OKK','okkRecord',m=>new OkkService({db:m.db},m.ws,strict({}),m.audit,m.attachments,strict({}))],['Returns','returnRecord',m=>new ReturnsService({db:m.db},m.attachments,m.audit,strict({}),m.ws)],['Stock','stockDefect',m=>new StockService({db:m.db},m.attachments,m.audit,m.ws)],['Report','errorReport',m=>new ErrorReportService({db:m.db},m.audit,m.attachments)]];
for(const [name,model,build]of owners)for(const variant of ['visible-archived','not-processed','null-result','missing-entity','foreign','other-author',...(name==='Report'?[]:['deleted'])])test(`R2-A quality ${name} actual create resolver ${variant}`,async()=>{
  const m=memory(),user={userId:'quality-author',selectedFactoryId:'quality-factory',departmentId:'quality-dept',role:'OKK',isAdmin:false,isGuest:false,permissions:[]};
  const row={id:'quality-result',factoryId:user.selectedFactoryId,createdById:user.userId,authorId:user.userId,deletedAt:null,archivedAt:new Date(),status:'ARCHIVED',description:'Сохранённый результат',author:null,factory:{name:'Завод'},closedBy:null};
  const rows=[row];m.data[model]=m.model(model,rows,{includes:name==='Report'?['author','factory','closedBy']:[]});m.operations.push({userId:user.userId,operationId:'quality-create',resultKey:row.id});
  if(variant==='not-processed')m.operations.length=0;if(variant==='null-result')m.operations[0].resultKey=null;if(variant==='missing-entity')rows.length=0;if(variant==='foreign')user.selectedFactoryId='foreign';if(variant==='other-author'){row.createdById='other';row.authorId='other';}if(variant==='deleted')row.deletedAt=new Date();
  const service=build(m),call=()=>service.findProcessedCreate(m.db,user,'quality-create');
  if(variant==='visible-archived')assert.equal((await call()).id,row.id);else if(variant==='not-processed')assert.equal(await call(),null);else await assert.rejects(call(),denied);
  assert.equal(m.writes.length,0);assert.equal(m.audits.length,0);assert.equal(m.events.length,0);
});
