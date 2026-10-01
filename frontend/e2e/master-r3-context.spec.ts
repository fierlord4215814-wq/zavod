import {test,expect,WebSocketRoute} from '@playwright/test';
import {isolate,linkedReplies,json,open,shot,permissions,unknown,errors,network,records,save,installEvidenceHooks} from './helpers/frontend-series';
installEvidenceHooks();

test('R3-B2 actual App auth-context revoke invalidates People draft and Back owner',async({page})=>{
 let revoked=false,meCalls=0;const sockets:WebSocketRoute[]=[];
 await isolate(page,{role:'MASTER',socket:s=>sockets.push(s),replies:async(r,p)=>{
  if(p==='/auth/me'){meCalls++;await json(r,{userId:'series-user',selectedFactoryId:'series-factory',role:'MASTER',isAdmin:false,isGuest:false,departmentId:'series-department',permissions:revoked?permissions:[...permissions,'people.notes.manage'],displayName:'Проверка контекста',availableFactories:[{id:'series-factory',name:'Изолированный завод',role:'MASTER',isGuest:false}]});return true;}
  return linkedReplies(r,p);
 }});
 await page.goto('/');await open(page,'Люди');await page.locator('.people-compact-row').filter({hasText:'Сервисов'}).click();
 await page.locator('.profile-card').getByRole('button',{name:'Добавить заметку',exact:true}).click();
 await page.getByLabel('Заметка',{exact:true}).fill('Черновик прежних прав');
 const initialMe=meCalls;revoked=true;sockets.at(-1)!.send(JSON.stringify({type:'auth_context_changed',payload:{message:'Права изменились'}}));
 await expect.poll(()=>meCalls).toBeGreaterThan(initialMe);
 await expect(page.getByRole('dialog')).toHaveCount(0);await expect(page.locator('.profile-card')).toBeHidden();
 await page.goBack();await expect(page.getByText('Изменения не сохранены',{exact:true})).toHaveCount(0);
 expect(network.filter(n=>n.method&&n.method!=='GET')).toEqual([]);expect(unknown).toEqual([]);expect(errors).toEqual([]);
 records.push({scope:'actual App WS client => /auth/me => store => mounted consumer; transport intercepted, not server authority proof'});save();await shot(page,'B2-revoke-closed');
});

test('R3-C5 response committed before revoke cannot trigger stale People follow-up reads',async({page})=>{
 let revoked=false,meCalls=0,lists=0,release:()=>void=()=>{};const sockets:WebSocketRoute[]=[];
 const pending=new Promise<void>(resolve=>release=resolve);
 await isolate(page,{role:'MASTER',socket:s=>sockets.push(s),replies:async(r,p)=>{
  if(p==='/auth/me'){meCalls++;await json(r,{userId:'series-user',selectedFactoryId:'series-factory',role:'MASTER',isAdmin:false,isGuest:false,departmentId:'series-department',permissions:revoked?permissions:[...permissions,'people.notes.manage'],displayName:'Проверка контекста',availableFactories:[{id:'series-factory',name:'Изолированный завод',role:'MASTER',isGuest:false}]});return true;}
  if(p==='/people')lists++;
  if(p==='/people/series-person/notes'&&r.request().method()==='POST'){expect(r.request().postDataJSON().text).toBe('Заметка до отзыва');await pending;await json(r,{id:'r3-note',text:'Заметка до отзыва'},201);return true;}
  return linkedReplies(r,p);
 }});
 try{
  await page.goto('/');await open(page,'Люди');await page.locator('.people-compact-row').filter({hasText:'Сервисов'}).click();
  await page.locator('.profile-card').getByRole('button',{name:'Добавить заметку',exact:true}).click();await page.getByLabel('Заметка',{exact:true}).fill('Заметка до отзыва');
  await page.getByRole('button',{name:'Сохранить',exact:true}).click();await expect.poll(()=>network.filter(n=>n.path==='/people/series-person/notes').length).toBe(1);
  const initialMe=meCalls,initialLists=lists;revoked=true;sockets.at(-1)!.send(JSON.stringify({type:'auth_context_changed',payload:{message:'Права изменились'}}));
  await expect.poll(()=>meCalls).toBeGreaterThan(initialMe);await expect.poll(()=>lists).toBeGreaterThan(initialLists);await expect(page.getByRole('dialog')).toHaveCount(0);
  const before=network.length;const responseDone=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/people/series-person/notes');release();await responseDone;
  await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
  expect(network.slice(before).filter(n=>n.path?.startsWith('/people/series-person'))).toEqual([]);
  await expect(page.getByRole('dialog')).toHaveCount(0);expect(network.filter(n=>n.method==='POST')).toHaveLength(1);expect(unknown).toEqual([]);expect(errors).toEqual([]);
  records.push({scope:'actual browser writer continuation; POST response is isolated memory, no real backend commit/rollback claim'});save();
 }finally{release();}
});
