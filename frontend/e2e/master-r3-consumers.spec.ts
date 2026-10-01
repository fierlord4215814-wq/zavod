import {test,expect} from '@playwright/test';
import {isolate,linkedReplies,json,open,shot,person,taskRow,lineRow,records,save,unknown,errors,network,installEvidenceHooks} from './helpers/frontend-series';
import {installNavigationTrace,mark,saveTrace} from './helpers/master-r3-trace';
installEvidenceHooks();
const people=Array.from({length:18},(_,i)=>({...person,id:i===14?person.id:`scroll-person-${i}`,userId:i===14?person.id:`scroll-person-${i}`,displayName:i===14?person.displayName:`Сервисный Сергей ${i+1}`}));
const attachment={id:'r3-task-image',originalName:'Осмотр оборудования.png',mimeType:'image/png',sizeBytes:68};
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64');
async function filteredSource(page:Parameters<typeof open>[0]){
 await open(page,'Люди');await page.locator('.people-shift-tabs').getByRole('button',{name:'На смене',exact:true}).click();
 await page.getByRole('button',{name:'Поиск и фильтры',exact:true}).click();await page.locator('.people-category-tabs').getByRole('button',{name:'Службы',exact:true}).click();
 await page.locator('.people-search-panel input').fill('Сервис');await page.getByRole('button',{name:'Показать',exact:true}).click();
 const row=page.locator('.people-compact-row').filter({hasText:'Сервисов'});await row.scrollIntoViewIfNeeded();return row;
}
for(const theme of ['dark','gray','light'])for(const width of [1440,360,390,430])test(`R3-B063 untraced stable ${theme} ${width} exact context nested media Back`,async({page})=>{
 // Keep geometry stable: a connected intercepted WS, no timed fallback banner.
 await isolate(page,{theme,role:'MASTER',socket:()=>{},replies:async(r,p)=>{
  if(p==='/people'){await json(r,{people,groups:{}});return true;}
  if(p==='/people/search'){await json(r,{queryAccepted:true,message:null,context:null,results:[]});return true;}
  if(p==='/tasks/board'){await json(r,{NEW:[],IN_PROGRESS:[],LONG:[],DONE:[]});return true;}
  if(p===`/tasks/${taskRow.id}`){await json(r,{...taskRow,attachments:[attachment]});return true;}
  if(p==='/attachments/r3-task-image/file'){await r.fulfill({contentType:'image/png',body:png});return true;}
  return linkedReplies(r,p);
 }});await page.setViewportSize({width,height:width===360?640:844});await page.goto('/');
 const row=await filteredSource(page);const expected=await page.evaluate(()=>scrollY);expect(expected).toBeGreaterThan(0);
 // Two consecutive transitions in the same original390 context; other widths
 // exercise only layout variants, not duplicate business mutations.
 for(let cycle=0;cycle<(theme==='dark'&&width===390?2:1);cycle++){
  await row.click();await expect(page.locator('.profile-card')).toContainText('Сервисов');
  if(cycle===0)await shot(page,`B-profile-${theme}-${width}`,{expected,cycle});
  await page.getByRole('button',{name:'Посмотреть заявку',exact:true}).click();await expect(page.getByRole('dialog')).toContainText(taskRow.description);
  await page.getByRole('dialog').getByRole('button',{name:'Открыть',exact:true}).click();await expect(page.locator('.attachment-large-preview')).toBeVisible();
  await page.goBack();await expect(page.locator('.attachment-large-preview')).toBeHidden();await expect(page.getByRole('dialog')).toContainText(taskRow.description);
  await page.goBack();await page.goBack();await expect(page.locator('.profile-card')).toContainText('Сервисов');await page.goBack();await expect(page.locator('.profile-card')).toBeHidden();
  await expect.poll(()=>page.evaluate(()=>scrollY)).toBe(expected);await expect(row).toBeInViewport();
 }
 await expect(page.locator('.people-shift-tabs').getByRole('button',{name:'На смене',exact:true})).toHaveAttribute('aria-pressed','true');
 await shot(page,`B-returned-${theme}-${width}`,{expected,logicalTarget:person.id,back:'media then detail then source then profile'});
 await page.getByRole('button',{name:'Поиск и фильтры',exact:true}).click();await expect(page.locator('.people-search-panel input')).toHaveValue('Сервис');
 await expect(page.locator('.people-category-tabs').getByRole('button',{name:'Службы',exact:true})).toHaveAttribute('aria-pressed','true');
 expect(network.filter(n=>n.method&&n.method!=='GET')).toEqual([]);expect(network.some(n=>n.path===`/tasks/${taskRow.id}`)).toBe(true);expect(unknown).toEqual([]);expect(errors).toEqual([]);
});

test('R3-B063 user scroll cancels pending late-list restoration',async({page})=>{
 await installNavigationTrace(page);let lists=0,release:()=>void=()=>{};const gate=new Promise<void>(resolve=>release=resolve);
 await isolate(page,{role:'MASTER',socket:()=>{},replies:async(r,p)=>{
  if(p==='/people'){if(++lists===3)await gate;await json(r,{people,groups:{}});return true;}
  if(p==='/people/search'){await json(r,{queryAccepted:true,message:null,context:null,results:[]});return true;}
  return linkedReplies(r,p);
 }});await page.setViewportSize({width:390,height:640});await page.goto('/');
 try{
  const row=await filteredSource(page);const expected=await page.evaluate(()=>scrollY);await row.click();await page.getByRole('button',{name:'Посмотреть заявку',exact:true}).click();
  await expect(page.getByRole('dialog')).toContainText(taskRow.description);await page.goBack();await page.goBack();await expect(page.locator('.profile-card')).toBeVisible();await page.goBack();await expect(page.locator('.profile-card')).toBeHidden();
  await page.mouse.move(180,350);await page.mouse.wheel(0,70);await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));await mark(page,'user-controlled-scroll');
  release();await expect(page.locator('.people-compact-row')).toHaveCount(18);await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
  const trace=await saveTrace(page,'cancel after user interaction');const marker=trace.events.findLast((r:any)=>r.label==='user-controlled-scroll').seq;
  expect(trace.events.filter((r:any)=>r.seq>marker&&r.event==='SCROLL_TO_BEFORE'&&r.args[0]?.top===expected)).toEqual([]);expect(unknown).toEqual([]);expect(errors).toEqual([]);
 }finally{release();}
});

test('R3-B063 response after rapid Back cannot reopen source profile',async({page})=>{
 let release:()=>void=()=>{},started=false;const gate=new Promise<void>(resolve=>release=resolve);
 await isolate(page,{role:'MASTER',socket:()=>{},replies:async(r,p)=>{if(p===`/people/${person.id}`){started=true;await gate;}return linkedReplies(r,p);}});
 try{
  await page.goto('/');await open(page,'Люди');await page.locator('.people-compact-row').click();await expect.poll(()=>started).toBe(true);await page.goBack();
  await expect(page.getByRole('button',{name:'Отправить администратору',exact:true})).toBeVisible();const response=page.waitForResponse(r=>new URL(r.url()).pathname===`/api/people/${person.id}`);release();await response;
  await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));await expect(page.locator('.profile-card')).toHaveCount(0);expect(unknown).toEqual([]);expect(errors).toEqual([]);
 }finally{release();}
});

test('R3-C1 actual People dependent position preserves invalid draft and sends only chosen current line',async({page})=>{
 const lines=[{...lineRow,id:'r3-line-A',name:'Первая линия',positions:[{id:'r3-position-A',name:'Оператор первой'}]},{...lineRow,id:'r3-line-B',name:'Вторая линия',positions:[{id:'r3-position-B',name:'Оператор второй'}]}];let posts:any[]=[];
 await isolate(page,{socket:()=>{},replies:async(r,p)=>{
  if(p==='/lines'){await json(r,lines);return true;}
  if(p===`/people/${person.id}`){await json(r,{...person,role:'WORKER'});return true;}
  if(p===`/people/${person.id}/skills`&&r.request().method()==='POST'){posts.push(r.request().postDataJSON());await json(r,{id:'r3-skill'});return true;}
  return linkedReplies(r,p);
 }});await page.setViewportSize({width:390,height:844});await page.goto('/');await open(page,'Люди');await page.locator('.people-compact-row').click();
 await page.getByRole('button',{name:/Навыки по линиям/}).click();await page.getByRole('button',{name:'Добавить навык',exact:true}).click();
 await page.getByRole('combobox',{name:/^Линия/}).selectOption('r3-line-A');await page.getByLabel('Позиция',{exact:true}).selectOption('r3-position-A');await page.getByRole('combobox',{name:/^Линия/}).selectOption('r3-line-B');
 await expect(page.getByLabel('Позиция',{exact:true})).toHaveValue('r3-position-A');await expect(page.getByLabel('Позиция',{exact:true})).toHaveAttribute('aria-invalid','true');
 await page.getByRole('button',{name:'Добавить',exact:true}).click();expect(posts).toHaveLength(0);await shot(page,'C1-People-position-unavailable');
 await page.getByLabel('Позиция',{exact:true}).selectOption('r3-position-B');await page.getByRole('button',{name:'Добавить',exact:true}).click();await expect.poll(()=>posts.length).toBe(1);
 expect(posts[0]).toMatchObject({lineId:'r3-line-B',positionId:'r3-position-B',experienceCount:1});expect(unknown).toEqual([]);expect(errors).toEqual([]);records.push({consumer:'PeopleScreen.createSkill',body:posts[0],server:'intercepted only'});save();
});
