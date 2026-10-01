import {expect,test} from '@playwright/test';
import {isolate,json,open,shot,records,save,errors,unknown,linkedReplies,installEvidenceHooks} from './helpers/frontend-series';
import {serviceBridge} from './helpers/master-r2-bridge';
installEvidenceHooks();
test('R3-E Task UI serializes create take complete through actual authority controllers receivers readers',async({page})=>{
 const b=serviceBridge('task');
 try{
  await isolate(page,{role:'MASTER',identity:{userId:'r2-manager',factoryId:'r2-factory'},socket:()=>{},replies:async(r,p)=>{
   if(p==='/auth/me'||p.startsWith('/tasks')||p.startsWith('/notifications')){const u=new URL(r.request().url());const result=await b.rpc({path:p,method:r.request().method(),query:Object.fromEntries(u.searchParams),body:r.request().postDataJSON()});await json(r,result.ok?result.value:{message:result.message},result.ok?200:result.status);return true;}return linkedReplies(r,p);
  }});await page.setViewportSize({width:390,height:844});await page.goto('/');await open(page,'Заявки');
  await page.getByRole('button',{name:'Создать заявку',exact:true}).click();await page.getByLabel('Описание',{exact:true}).fill('Проверить датчик упаковки');await page.getByLabel('Конкретный исполнитель',{exact:true}).selectOption('r2-manager');
  await page.getByRole('button',{name:'Подтвердить',exact:true}).click();await expect(page.locator('.action-modal-backdrop')).toHaveCount(0);
  await page.locator('.task-card').filter({hasText:'Проверить датчик упаковки'}).getByRole('button',{name:'Открыть',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'Взять в работу',exact:true}).click();
  await expect(page.getByRole('dialog').getByRole('button',{name:'Взять в работу',exact:true})).toHaveCount(0);await page.getByRole('dialog').getByRole('button',{name:'Завершить заявку',exact:true}).click();await page.getByLabel('Комментарий',{exact:true}).fill('Датчик проверен');await page.locator('.action-modal-backdrop').getByRole('button',{name:'Подтвердить',exact:true}).click();await expect(page.locator('.action-modal-backdrop')).toHaveCount(0);
  const state=(await b.rpc({command:'inspect'})).value;expect(state.tasks).toHaveLength(1);const id=state.tasks[0].id;expect(state.tasks[0].status).toBe('DONE');expect(state.operations.filter((x:any)=>x.resultKey===id)).toHaveLength(3);
  expect(state.notices.some((x:any)=>x.entityId===id&&x.type==='TASK_DONE')).toBe(true);expect(state.audits.filter((x:any)=>x.action==='TASK_DONE')).toHaveLength(1);
  const request=b.traffic.find(r=>r.direction==='request'&&r.path==='/tasks'&&r.method==='POST');expect(request.body.description).toBe('Проверить датчик упаковки');expect(request.body.lineId).toBeNull();expect(request.body.departmentRecipientIds).toEqual([]);
  const audit=await b.rpc({path:'/ops/audit',actor:'r3-management',query:{entityType:'Task',entityId:id,dateFrom:'2026-09-15T00:00:00Z',dateTo:'2026-09-16T00:00:00Z'}});expect(audit.ok).toBe(true);expect(audit.value.some((x:any)=>x.action==='TASK_DONE')).toBe(true);
  await shot(page,'E-task-actual-completed',{entityId:id,layer:'UI-client-IPC-authority-controller-service-actual-audit-notifications-memory'});await page.goBack();await expect(page.getByRole('dialog')).toHaveCount(0);
  await b.rpc({command:'revoke'});const denied=await b.rpc({path:`/tasks/${id}`});expect(denied.ok).toBe(false);expect(denied.status).toBe(403);expect(unknown).toEqual([]);expect(errors).toEqual([]);
  expect(b.traffic.filter(r=>r.direction==='reply'&&!r.ok&&r.status!==403)).toEqual([]);
 }finally{records.push({bridge:'task actual receivers',traffic:b.traffic});save();await b.close();}
});
for(const state of ['expired','future'] as const)test(`R3-C4 actual publication ${state} UI denial does not become ACK success`,async({page})=>{
 const b=serviceBridge('publication');try{
  await isolate(page,{role:'MASTER',replies:async(r,p)=>{if(p==='/auth/me'||p.startsWith('/announcements')){const result=await b.rpc({path:p,method:r.request().method(),body:r.request().postDataJSON(),query:Object.fromEntries(new URL(r.request().url()).searchParams)});await json(r,result.ok?result.value:{message:result.message},result.ok?200:result.status);return true;}return linkedReplies(r,p);}});
  await page.goto('/');await open(page,'Объявления');await expect(page.getByRole('button',{name:'Ознакомлен',exact:true})).toBeVisible();await b.rpc({command:'publicationState',state});await page.getByRole('button',{name:'Ознакомлен',exact:true}).click();await expect(page.getByText('Вы не входите в получатели этого объявления.',{exact:true})).toBeVisible();
  // Wait for the owner's existing 8s refresh, not an arbitrary sleep or forced reload.
  await expect(page.getByRole('heading',{name:'Новых объявлений нет.',exact:true})).toBeVisible({timeout:12000});
  await expect(page.getByText('Все важные сообщения уже прочитаны.',{exact:false})).toHaveCount(0);
  const saved=(await b.rpc({command:'inspect'})).value;expect(saved.reads).toHaveLength(0);expect(saved.notices[0].readAt).toBeNull();expect(saved.audits.some((x:any)=>x.action==='ACCESS_DENIED')).toBe(true);await shot(page,`C4-${state}-real-denial`,{state,readCount:0});expect(unknown).toEqual([]);expect(errors).toEqual([]);
 }finally{records.push({bridge:`publication ${state}`,traffic:b.traffic});save();await b.close();}
});
test('R3-E Chat actual message attachment preview membership revoke denies new bytes and releases client resource',async({page})=>{
 const b=serviceBridge('chat');let socket:any;
 try{
  await isolate(page,{role:'MASTER',identity:{userId:'membership-actor',factoryId:'membership-factory'},socket:s=>{socket=s;},replies:async(r,p)=>{
   if(p==='/auth/me'||p.startsWith('/chats')||p.startsWith('/attachments')||p.startsWith('/directory/')){const result=await b.rpc({path:p,method:r.request().method(),body:r.request().postDataJSON(),query:Object.fromEntries(new URL(r.request().url()).searchParams)});if(result.ok&&result.value?.encoding==='base64')await r.fulfill({status:200,contentType:result.value.headers['Content-Type'],body:Buffer.from(result.value.body,'base64')});else await json(r,result.ok?result.value:{message:result.message},result.ok?200:result.status);return true;}return linkedReplies(r,p);
  }});
  await page.addInitScript(()=>{const created:string[]=[],revoked:string[]=[];(window as any).__r3Urls={created,revoked};const create=URL.createObjectURL.bind(URL),revoke=URL.revokeObjectURL.bind(URL);URL.createObjectURL=value=>{const id=create(value);created.push(id);return id;};URL.revokeObjectURL=id=>{revoked.push(id);revoke(id);};});
  await page.setViewportSize({width:390,height:844});await page.goto('/');await open(page,'Чаты');await page.getByRole('button').filter({hasText:'Упаковка'}).first().click();await page.getByLabel('Сообщение',{exact:true}).fill('Проверьте ограждение линии');await page.getByRole('button',{name:'Отправить',exact:true}).click();
  await expect(page.locator('.messenger-message')).toContainText('Проверьте ограждение линии');let saved=(await b.rpc({command:'inspect'})).value;const message=saved.messages.find((x:any)=>x.text==='Проверьте ограждение линии');expect(message).toBeTruthy();
  const file=await b.rpc({command:'chatFileFixture',entityId:message.id});expect(file.ok).toBe(true);
  socket.send(JSON.stringify({type:'chat_updated',payload:{chatId:'membership-chat'}}));
  await page.locator('.attachment-preview').filter({hasText:'Осмотр.txt'}).getByRole('button',{name:'Открыть',exact:true}).click();await expect(page.locator('.attachment-viewer-backdrop')).toBeVisible();
  await expect.poll(async()=>((await b.rpc({command:'inspect'})).value.storageReadCount)).toBe(1);await shot(page,'E-chat-actual-preview',{layer:'actual-controller-service-memory-file; no upload/HTTP range proof'});
  expect((await b.rpc({path:'/chats/membership-chat/transfer-ownership',method:'POST',body:{userId:'membership-target',operationId:'r3-transfer'}})).ok).toBe(true);
  expect((await b.rpc({path:'/chats/membership-chat/members/membership-actor/remove',method:'POST',actor:'membership-target',body:{operationId:'r3-remove'}})).ok).toBe(true);
  socket.send(JSON.stringify({type:'chat_updated',payload:{chatId:'membership-chat'}}));await expect(page.locator('.attachment-viewer-backdrop')).toHaveCount(0);await expect(page.getByLabel('Сообщение',{exact:true})).toHaveCount(0);
  for(const path of ['/attachments/message-file','/attachments/message-file/file','/chats/membership-chat']){const result=await b.rpc({path});expect(result.ok).toBe(false);expect(result.status).toBe(403);}
  saved=(await b.rpc({command:'inspect'})).value;expect(saved.storageReadCount).toBe(1);const urls=await page.evaluate(()=>(window as any).__r3Urls);expect(urls.created.length).toBeGreaterThan(0);expect(urls.created.every((id:string)=>urls.revoked.includes(id))).toBe(true);expect(b.traffic.filter(r=>r.direction==='reply'&&!r.ok&&r.status!==403)).toEqual([]);expect(unknown).toEqual([]);expect(errors).toEqual([]);
 }finally{records.push({bridge:'chat actual guarded bytes',traffic:b.traffic});save();await b.close();}
});
