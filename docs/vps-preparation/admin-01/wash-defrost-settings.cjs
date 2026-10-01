const {assert,chromium,api,admin,actor,db,navigate}=require('./harness.cjs');
const {switchC,ids}=require('./users-journey.cjs');
const {mutate}=require('./ui-helpers.cjs');
const {settings}=require('./module-helpers.cjs');
const fs=require('node:fs'),path=require('node:path'),{randomUUID}=require('node:crypto');
const file=path.join(__dirname,'wash-defrost-settings.json');
const ev=fs.existsSync(file)?JSON.parse(fs.readFileSync(file)):{status:'IN_PROGRESS'};
const save=()=>fs.writeFileSync(file,JSON.stringify(ev,null,2));
const modal=(p,title)=>p.getByRole('dialog').filter({has:p.getByRole('heading',{name:title,exact:true})});
async function denied(page,method,url,body){const r=await api(page,method,url,body);assert.equal(r.status,409,JSON.stringify(r));return {status:r.status,message:r.body.message};}
async function washOpen(page){await navigate(page,'Мойка');if(!await page.getByRole('button',{name:'Проблема',exact:true}).isVisible())await page.locator('.wash-session-card').filter({hasText:'Линия настройки C'}).getByRole('button',{name:'Открыть',exact:true}).click();}
async function main(){const b=await chromium.launch({channel:'msedge',headless:true});let a,o,m,p,restoreWash,restoreDefrost;
 try{p=await db();a=await admin(b);o=await admin(b);m=await actor(b,'master');await switchC(a.page);await switchC(o.page);
 if(!ev.washDone){
  const keys=['washIssueResolveRequiresPhoto','washCompleteRequiresOkkReview','washCompleteRequiresNoOpenIssues','washMiniTasksEnabled','washControlEnabled','washOkkReviewEnabled'];
  const current=(await api(a.page,'GET','/admin/wash-settings')).body;
  restoreWash=ev.washBefore||Object.fromEntries(keys.map(k=>[k,current[k]]));ev.washBefore=restoreWash;save();
  await settings(a.page,'wash',{washIssueResolveRequiresPhoto:true,washCompleteRequiresOkkReview:true,washCompleteRequiresNoOpenIssues:true,washMiniTasksEnabled:false,washControlEnabled:false,washOkkReviewEnabled:false});
  await navigate(o.page,'Мойка');await navigate(m.page,'Мойка');
  if(!ev.washId){await o.page.getByRole('button',{name:'Начать мойку',exact:true}).click();const d=o.page.locator('.wash-start-modal');await d.getByLabel(/^Остановленная линия/).selectOption(ids.line);const r=await mutate(o.page,'POST','/wash/start',()=>d.getByRole('button',{name:'Начать мойку',exact:true}).click(),201);ev.washId=r.body.id;save();}
  await washOpen(o.page);
  if(!ev.issueId){await o.page.getByRole('button',{name:'Проблема',exact:true}).click();const d=modal(o.page,'Проблема мойки');await d.getByLabel('Коротко что не так',{exact:true}).fill('Проверка настроек мойки ADMIN01');await d.getByLabel('Описание',{exact:true}).fill('Ограниченная проверка обязательных условий');const r=await mutate(o.page,'POST',`/wash/${ev.washId}/issues`,()=>d.getByRole('button',{name:'Подтвердить',exact:true}).click(),201);ev.issueId=r.body.id;save();}
  if(!ev.washGuards){
   ev.miniOff=await denied(o.page,'POST',`/wash/${ev.washId}/control-items`,{title:'MUST_NOT_CREATE',type:'MINI_TASK'});
   ev.controlOff=await denied(o.page,'POST',`/wash/${ev.washId}/control-items`,{title:'MUST_NOT_CREATE',type:'CONTROL'});
   ev.okkOff=await denied(o.page,'POST',`/wash/${ev.washId}/okk-review`,{status:'APPROVED',comment:'MUST_NOT_CREATE'});
   ev.openIssue=await denied(o.page,'POST',`/wash/${ev.washId}/complete`,{operationId:randomUUID()});assert.match(ev.openIssue.message,/открытые проблемы/);
   ev.photoRequired=await denied(o.page,'PATCH',`/wash/issues/${ev.issueId}/status`,{status:'RESOLVED',comment:'Проверка требования фото'});assert.match(ev.photoRequired.message,/фото/);
   await settings(a.page,'wash',{washCompleteRequiresNoOpenIssues:false,washOkkReviewEnabled:true});
   ev.noIssueGate=await denied(o.page,'POST',`/wash/${ev.washId}/complete`,{operationId:randomUUID()});assert.match(ev.noIssueGate.message,/ОКК/);
   ev.washGuards=true;save();
  }
  await settings(a.page,'wash',{washIssueResolveRequiresPhoto:false,washCompleteRequiresNoOpenIssues:true,washMiniTasksEnabled:true,washControlEnabled:true,washOkkReviewEnabled:true});
  if(!ev.issueResolved){await o.page.locator('.wash-detail-tabs').getByRole('tab',{name:/Проблемы/}).click();await o.page.getByRole('button',{name:/Проблема решена|Закрыть проблему/}).first().click();const d=modal(o.page,'Закрыть проблему');await d.getByLabel('Что сделали',{exact:true}).fill('Учебный контроль завершён, фото не требуется настройкой');await mutate(o.page,'PATCH',`/wash/issues/${ev.issueId}/status`,()=>d.getByRole('button',{name:'Подтвердить',exact:true}).click(),200);ev.issueResolved=true;save();}
  for(const type of ['MINI_TASK','CONTROL']){
   ev.controls||={};if(!ev.controls[type]){await o.page.getByRole('button',{name:'Задание',exact:true}).click();const d=modal(o.page,'Задание по мойке');await d.getByLabel('Что проверить или домыть',{exact:true}).fill(`Учебный ${type==='CONTROL'?'контроль':'мини-задание'} ADMIN01`);await d.getByLabel('Комментарий',{exact:true}).fill('Настройка включена через Admin UI');await d.getByLabel('Тип',{exact:true}).selectOption(type);const r=await mutate(o.page,'POST',`/wash/${ev.washId}/control-items`,()=>d.getByRole('button',{name:'Подтвердить',exact:true}).click(),201);ev.controls[type]=r.body.id;save();}
  }
  if(!ev.controlsDone){for(const type of ['MINI_TASK','CONTROL']){const state=await p.washControlItem.findUnique({where:{id:ev.controls[type]},select:{status:true}});if(state.status==='DONE')continue;await o.page.locator('.wash-detail-tabs').getByRole('tab',{name:type==='CONTROL'?'Контроль':'Задания',exact:true}).click();await o.page.getByRole('button',{name:/Закрыть задание|Отметить выполненным/}).first().click();const d=modal(o.page,'Выполнить задание');await d.getByLabel('Комментарий',{exact:true}).fill('Учебная проверка завершена');await mutate(o.page,'PATCH',`/wash/control-items/${ev.controls[type]}`,()=>d.getByRole('button',{name:'Подтвердить',exact:true}).click(),200);await d.waitFor({state:'hidden'});}ev.controlsDone=true;save();}
  if(!ev.okkReview){ev.reviewRequired=await denied(o.page,'POST',`/wash/${ev.washId}/complete`,{operationId:randomUUID()});assert.match(ev.reviewRequired.message,/ОКК/);await o.page.getByRole('button',{name:'ОКК-проверка',exact:true}).click();const d=modal(o.page,'ОКК-проверка мойки');await d.getByLabel('Решение',{exact:true}).selectOption('APPROVED');await d.getByLabel('Комментарий',{exact:true}).fill('Приёмка настройки ОКК ADMIN01');const r=await mutate(o.page,'POST',`/wash/${ev.washId}/okk-review`,()=>d.getByRole('button',{name:'Подтвердить',exact:true}).click(),201);ev.okkReview=r.body.id;save();}
  await washOpen(m.page);await o.page.getByRole('button',{name:'Завершить мойку',exact:true}).click();const d=modal(o.page,'Завершить мойку'),t=Date.now();await mutate(o.page,'POST',`/wash/${ev.washId}/complete`,()=>d.getByRole('button',{name:'Завершить мойку',exact:true}).click(),201);await m.page.getByText('Мойка завершена',{exact:true}).first().waitFor({timeout:15000});ev.washSecondUiMs=Date.now()-t;ev.washSql=await p.washSession.findUnique({where:{id:ev.washId},select:{id:true,factoryId:true,status:true}});assert.equal(ev.washSql.status,'DONE');ev.washDone=true;save();await settings(a.page,'wash',restoreWash);restoreWash=null;ev.washRestored=true;save();
 }
 if(!ev.defrostDone){
  const current=(await api(a.page,'GET','/admin/defrost-settings')).body;restoreDefrost=ev.defrostBefore||{defrostCommentRequiredOnStart:current.defrostCommentRequiredOnStart,defrostCommentRequiredOnEnd:current.defrostCommentRequiredOnEnd};ev.defrostBefore=restoreDefrost;save();await settings(a.page,'defrost',{defrostCommentRequiredOnStart:true,defrostCommentRequiredOnEnd:true});
  const active=await p.defrostEvent.findFirst({where:{lineId:ids.line,factoryId:ids.factory,status:'ACTIVE'},select:{id:true,comment:true}});
  assert(active,'The previous observed today-API success must be reconciled, not blindly repeated');ev.defrostId=active.id;ev.todayBefore={status:201,id:active.id,comment:active.comment};ev.defrostContract='docs/stage37-defrost-calendar-ux.md:50 — today endpoints explicitly ignore legacy comment flags; DEFERRED_BY_PRODUCT for current UI settings';
  ev.legacyEndGuard=await denied(o.page,'POST',`/defrost/${active.id}/end`,{operationId:randomUUID()});assert.match(ev.legacyEndGuard.message,/комментарий/i);save();
  await navigate(o.page,'Оттайка');await o.page.getByRole('button',{name:'Запустить в работу',exact:true}).click();let d=o.page.locator('.defrost-action-modal');await d.getByLabel('Комментарий',{exact:true}).fill('');await mutate(o.page,'POST',`/defrost/lines/${ids.line}/complete-today`,()=>d.locator('.defrost-modal-line').filter({hasText:'Линия настройки C'}).click(),201);
  await o.page.getByRole('button',{name:'Поставить на оттайку',exact:true}).click();d=o.page.locator('.defrost-action-modal');await d.getByLabel('Комментарий',{exact:true}).fill('');const started=await mutate(o.page,'POST',`/defrost/lines/${ids.line}/start-today`,()=>d.locator('.defrost-modal-line').filter({hasText:'Линия настройки C'}).click(),201);ev.todayUiId=started.body.id;save();
  await o.page.getByRole('button',{name:'Запустить в работу',exact:true}).click();d=o.page.locator('.defrost-action-modal');await d.getByLabel('Комментарий',{exact:true}).fill('');await mutate(o.page,'POST',`/defrost/lines/${ids.line}/complete-today`,()=>d.locator('.defrost-modal-line').filter({hasText:'Линия настройки C'}).click(),201);
  ev.defrostDone=true;ev.defrostSql=await p.defrostEvent.findMany({where:{lineId:ids.line},select:{id:true,status:true,factoryId:true,startAt:true,endAt:true}});assert(ev.defrostSql.every(x=>x.status==='COMPLETED'));save();await settings(a.page,'defrost',restoreDefrost);restoreDefrost=null;ev.defrostRestored=true;save();
 }
 ev.status='PASS_WASH6_CONSUMERS_DEFROST_LEGACY_FLAGS_SUPERSEDED_RESTORED';save();console.log(JSON.stringify({status:ev.status,wash:ev.washId,defrost:ev.defrostId}));
 }catch(e){ev.error=e.message;ev.ui=o?(await o.page.locator('body').innerText()).slice(-6000):null;save();throw e;}finally{try{if(a&&restoreWash){await settings(a.page,'wash',restoreWash);ev.washRestored=true;}if(a&&restoreDefrost){await settings(a.page,'defrost',restoreDefrost);ev.defrostRestored=true;}save();}finally{await p?.$disconnect();await b.close();}}
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
