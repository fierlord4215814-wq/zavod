import { expect, test, Page, WebSocketRoute } from '@playwright/test';
import { permissions, records, network, errors, unknown, json, before, isolate, shot, save, open, end, geometry, serviceTask, person, taskRow, taskSummary, lineRow, linkedReplies } from './helpers/frontend-series';
import { installEvidenceHooks } from './helpers/frontend-series';
installEvidenceHooks();

test('Series A navigation geometry and history end controls',async ({page})=>{
  test.setTimeout(240000);
  await isolate(page);
  await page.goto('/');
  await expect(page.locator('.app-shell')).toBeVisible();
  for(const theme of ['dark','gray','light']) {
    // Change the real persisted theme through the existing Settings UI, once per theme.
    if(theme!=='dark') {
      await page.setViewportSize({width:1440,height:844});
      await page.locator('.nav-settings-button').click();
      await page.getByRole('button',{name:theme==='gray'?'Серая':'Светлая',exact:true}).click();
      await page.goBack();
      await expect(page.locator('.mobile-nav-sheet h2')).toHaveText('Ещё');
      await page.goBack();
      await expect(page.locator('.mobile-sheet-backdrop')).toBeHidden();
    }
    for(const [width,height] of [[1440,844],[360,844],[390,844],[430,844],[360,640],[1440,720]]) {
      await page.setViewportSize({width,height});
      await open(page,'История смен');
      const history=page.getByTestId('worker-shift-history');
      await expect(history).toBeVisible();
      await history.getByRole('button',{name:'2026-09-07, дневная смена, ночная смена',exact:true}).click();
      await end(page);
      const choice=history.locator('.shift-history-choice-card');
      await shot(page,`A-${theme}-${width}-${height}-choice`,{geometry:await geometry(page),role:'ADMIN',state:'history-choice'});
      await choice.getByRole('button',{name:/Ночь.*20:00.*08:00/}).click();
      await end(page);
      const back=history.getByRole('button',{name:'Назад к календарю',exact:true});
      const bounds=await back.boundingBox(); const g=await geometry(page);
      await shot(page,`A-${theme}-${width}-${height}-detail`,{geometry:g,target:bounds,role:'ADMIN',state:'history-detail'});
      if(!before) { expect(g.overflow).toBeLessThanOrEqual(1); expect(g.navScroll).toBeLessThanOrEqual(g.navClient+1); expect(bounds!.y+bounds!.height).toBeLessThanOrEqual(g.nav.y); }
      await back.click();
      await expect(choice).toBeVisible();
      await open(page,'Сообщить');
    }
  }
  expect(unknown).toEqual([]); expect(errors).toEqual([]);
});

test('Series A restricted navigation short page and long settings sheet',async ({page})=>{
  test.setTimeout(120000);
  await isolate(page,{role:'WORKER'});
  await page.goto('/');
  for (const theme of ['dark','gray','light']) {
    await page.setViewportSize({width:1440,height:720});
    await page.locator('.nav-settings-button').click();
    await page.getByRole('button',{name:({dark:'Тёмная',gray:'Серая',light:'Светлая'})[theme],exact:true}).click();
    await page.goBack(); await expect(page.locator('.mobile-nav-sheet h2')).toHaveText('Ещё');
    await page.goBack(); await expect(page.locator('.mobile-sheet-backdrop')).toBeHidden();
    for(const [width,height] of [[1440,720],[360,640],[390,844],[430,844]]) {
      await page.setViewportSize({width,height});
      await open(page,'Уведомления');
      await expect(page.getByText('Уведомлений нет.',{exact:true})).toBeVisible();
      await end(page);
      const g=await geometry(page);
      expect(g.navScroll).toBeLessThanOrEqual(g.navClient+1);
      expect(parseFloat(g.padding)).toBeLessThanOrEqual(g.nav.height+25);
      expect(g.overflow).toBeLessThanOrEqual(1);
      await shot(page,`A-worker-${theme}-${width}-short`,{role:'WORKER',state:'short-empty-notifications',geometry:g});
    }
  }
  await page.getByRole('button',{name:'Ещё',exact:true}).click();
  await page.locator('.mobile-nav-sheet').getByRole('button',{name:/Настройки/}).click();
  const sheet=page.locator('.mobile-nav-sheet');
  await page.mouse.move(200,500); await page.mouse.wheel(0,100000);
  await shot(page,'A-worker-long-settings-end',{role:'WORKER',state:'settings-internal-scroll'});
  await page.goBack(); await expect(sheet.locator('h2')).toHaveText('Ещё');
  await page.goBack(); await expect(sheet).toBeHidden();
  expect(await page.evaluate(()=>getComputedStyle(document.body).overflow)).not.toBe('hidden');
  expect(unknown).toEqual([]); expect(errors).toEqual([]);
});

test('Series B real linked sources exact target and parent Back',async({page})=>{
  test.setTimeout(120000);
  await isolate(page,{role:'TECH_MECHANIC',replies:linkedReplies}); await page.goto('/');
  for(const width of [1440,390,360,430]) {
    await page.setViewportSize({width,height:844});
    for(const source of ['Люди','Смена','Линии']) {
      await open(page,source);
      if(source==='Люди') await page.locator('.people-compact-row').filter({hasText:'Сервисов'}).first().click();
      if(source==='Смена') await page.locator('.person-card').filter({hasText:'Сервисов'}).getByRole('button',{name:/Сервисов/}).first().click();
      if(source==='Линии') await page.locator('.line-card').getByRole('button',{name:'Линия фасовки',exact:true}).first().click();
      const sourceButton=page.getByRole('button',{name:source==='Линии'?/Открыть заявку/:/Посмотреть заявку/}).first();
      await expect(sourceButton).toBeVisible();
      await shot(page,`B-${width}-${source}-source`,{source,state:'real-source-button'});
      await sourceButton.click();
      await expect(page.getByRole('heading',{name:'Заявки',exact:true})).toBeVisible();
      await expect(page.locator('.task-card').first()).toBeVisible();
      await shot(page,`B-${width}-${source}-target`,{source,state:'source-result'});
      if(before) {
        expect(await page.getByRole('dialog').count()).toBe(0);
        expect(await page.evaluate(()=>localStorage.getItem('zavod.taskHighlightId'))).toBe('series-task');
        await page.goBack();
      } else {
        const detail=page.getByRole('dialog'); await expect(detail).toContainText(taskRow.description);
        await page.goBack(); await expect(detail).toBeHidden();
        await page.goBack(); await expect(sourceButton).toBeVisible();
        await page.goBack();
      }
    }
  }
  expect(unknown).toEqual([]); expect(errors).toEqual([]);
});

test('Series B delayed board missing target and one-shot reload',async({page})=>{
  test.setTimeout(60000);
  let release: (()=>void)|undefined; let mode='delay';
  await isolate(page,{replies:async(route,p)=>{
    if(p==='/tasks/series-task'&&mode==='missing') {await json(route,{message:'Заявка не найдена.'},404);return true;}
    if(p==='/tasks/board') {
      if(mode==='delay') await new Promise<void>(resolve=>{release=resolve;});
      await json(route,mode==='missing'?{NEW:[],IN_PROGRESS:[],LONG:[],DONE:[]}:{NEW:[],IN_PROGRESS:[taskRow],LONG:[],DONE:[]});return true;
    }
    return linkedReplies(route,p);
  }});
  await page.setViewportSize({width:390,height:844}); await page.goto('/');
  await open(page,'Люди'); await page.locator('.people-compact-row').first().click();
  await page.getByRole('button',{name:'Посмотреть заявку',exact:true}).click();
  await expect.poll(()=>Boolean(release)).toBe(true);
  await expect(page.getByRole('dialog')).toBeHidden();
  await shot(page,'B-delayed-loading',{state:'pending-board-no-premature-detail'});
  mode='loaded'; release!();
  await expect(page.getByRole('dialog')).toContainText(taskRow.description);
  await page.goBack(); await expect(page.getByRole('dialog')).toBeHidden();
  await page.reload(); await expect(page.locator('.task-card').first()).toBeVisible();
  await expect(page.getByRole('dialog')).toBeHidden();
  expect(await page.evaluate(()=>localStorage.getItem('zavod.taskHighlightId'))).toBeNull();
  mode='missing'; await open(page,'Люди'); await page.locator('.people-compact-row').first().click();
  await page.getByRole('button',{name:'Посмотреть заявку',exact:true}).click();
  await expect(page.getByText(/Связанная заявка недоступна/)).toBeVisible();
  await expect(page.getByRole('dialog')).toBeHidden();
  await shot(page,'B-missing-fallback',{state:'not-in-authorized-board'});
  await page.goBack(); await expect(page.getByRole('button',{name:'Посмотреть заявку',exact:true})).toBeVisible();
  await page.goBack(); await open(page,'Заявки'); await expect(page.getByRole('dialog')).toBeHidden();
  await page.goBack(); await expect(page.getByRole('heading',{name:'Люди',exact:true})).toBeVisible();
  await expect(page.locator('.profile-card')).toBeHidden();
  expect(unknown).toEqual([]); expect(errors).toEqual([]);
});

test('Series C internal notification read count and Back',async({page})=>{
  test.setTimeout(60000);
  let readAt: string|null=null; const reads: string[]=[];
  await isolate(page,{replies:async(route,p)=>{
    if(p==='/notifications') {await json(route,[{id:'series-notice',factoryId:'series-factory',sourceRoute:'tasks',title:'Заявка требует внимания',message:'Проверить датчик линии',severity:'WARNING',createdAt:'2026-09-15T00:00:00Z',readAt}]);return true;}
    if(p==='/notifications/unread-count') {await json(route,{count:readAt?0:1});return true;}
    if(p==='/notifications/series-notice/read'&&route.request().method()==='POST') {reads.push(route.request().headers()['x-factory-id']);readAt='2026-09-15T00:10:00Z'; await json(route,{ok:true});return true;}
    return linkedReplies(route,p);
  }});
  await page.goto('/');
  for(const width of [1440,390,360,430]) {
    await page.setViewportSize({width,height:844});
    readAt=null; await open(page,'Уведомления');
    const card=page.locator('.notification-card'); await expect(card).toContainText('не прочитано');
    await end(page);
    await shot(page,`C-${width}-before-open`,{state:'unread-internal'});
    const n=reads.length; await card.getByRole('button',{name:'Открыть',exact:true}).click();
    await expect(page.getByRole('heading',{name:'Заявки',exact:true})).toBeVisible();
    expect(reads.length-n).toBe(before?0:1);
    await page.goBack(); await expect(card).toBeVisible();
    await expect(card).toContainText(before?'не прочитано':'прочитано');
    if(!before) await expect(card.getByRole('button',{name:'Отметить прочитанным'})).toBeHidden();
    await end(page);
    await shot(page,`C-${width}-returned`,{state:'back-to-feed',reads:[...reads]});
    await open(page,'Заявки');
  }
  expect(reads.every(x=>x==='series-factory')).toBe(true);
  expect(unknown).toEqual([]); expect(errors).toEqual([]);
});

test('Series C error retry duplicate adapters and foreign denial',async({page})=>{
  test.setTimeout(60000);
  let readAt: string|null=null; let fail=true; let reads=0; let denySource=false; let holdRead=false; let releaseRead:(()=>void)|undefined;
  await isolate(page,{replies:async(route,p)=>{
    if(p==='/auth/me'&&denySource) {await json(route,{userId:'series-user',selectedFactoryId:'series-factory',role:'WORKER',isAdmin:false,isGuest:false,permissions:['notifications.read'],availableFactories:[{id:'series-factory',name:'Изолированный завод',role:'WORKER',isGuest:false}]});return true;}
    if(p==='/notifications') {await json(route,[{id:'series-notice',factoryId:'series-factory',sourceRoute:'tasks',title:'Проверка повторов',message:'Сохранить источник',severity:'WARNING',createdAt:'2026-09-15T00:00:00Z',readAt},{id:'no-source',title:'Источник удалён',message:'Событие без перехода',severity:'INFO',createdAt:'2026-09-15T00:00:00Z',readAt:null,sourceRoute:null}]);return true;}
    if(p==='/notifications/unread-count') {await json(route,{count:readAt?1:2});return true;}
    if(p==='/notifications/series-notice/read'&&route.request().method()==='POST') {
      reads++;
      if(route.request().headers()['x-factory-id']==='foreign-factory') {await json(route,{message:'Доступ к заводу больше не действует.'},403);return true;}
      if(fail) {await json(route,{message:'Не удалось отметить уведомление. Повторите.'},503);return true;}
      if(holdRead) await new Promise<void>(resolve=>{releaseRead=resolve;});
      readAt='2026-09-15T00:10:00Z'; await json(route,{ok:true});return true;
    }
    return linkedReplies(route,p);
  }});
  await page.setViewportSize({width:390,height:844}); await page.goto('/');
  await open(page,'Уведомления');
  const card=page.locator('.notification-card').filter({hasText:'Проверка повторов'});
  await expect(page.locator('.notification-card').filter({hasText:'Источник удалён'}).getByRole('button',{name:'Открыть',exact:true})).toBeHidden();
  await card.getByRole('button',{name:'Открыть',exact:true}).click();
  await expect(page.locator('.error-state')).toContainText('Ошибка сервера. Повторите позже.');
  await expect(card).toContainText('не прочитано'); expect(reads).toBe(1);
  await shot(page,'C-error-no-false-read',{state:'POST503-stays-unread'});
  fail=false; await card.getByRole('button',{name:'Открыть',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Заявки',exact:true})).toBeVisible(); expect(reads).toBe(2);
  await page.goBack(); await expect(card).toBeVisible();
  await card.getByRole('button',{name:'Открыть',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Заявки',exact:true})).toBeVisible(); expect(reads).toBe(3);
  await page.goBack(); await expect(card).toBeVisible();
  holdRead=true;
  await page.evaluate(()=>{
    const detail={notificationId:'series-notice',factoryId:'series-factory',sourceRoute:'tasks'};
    window.dispatchEvent(new CustomEvent('zavod:notification-navigation',{detail}));
  });
  await expect.poll(()=>Boolean(releaseRead)).toBe(true);
  await page.evaluate(()=>navigator.serviceWorker.dispatchEvent(new MessageEvent('message',{data:{type:'ZAVOD_NOTIFICATION_NAVIGATION',intent:{notificationId:'series-notice',factoryId:'series-factory',sourceRoute:'tasks'}}})));
  // Flush the adapter effect across frames while the first operation is still held.
  await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
  expect(reads).toBe(4); holdRead=false; releaseRead!();
  await expect(page.getByRole('heading',{name:'Заявки',exact:true})).toBeVisible(); expect(reads).toBe(4);
  await page.goBack(); await expect(card).toBeVisible();
  await page.evaluate(()=>window.dispatchEvent(new CustomEvent('zavod:notification-navigation',{detail:{notificationId:'series-notice',factoryId:'foreign-factory',sourceRoute:'tasks'}})));
  await expect(page.getByText('Доступ к заводу больше не действует.',{exact:false})).toBeVisible();
  await expect(page.locator('.brand-name')).toHaveText('Изолированный завод');
  expect(network.filter(x=>x.path?.startsWith('/tasks')&&x.factory==='foreign-factory')).toEqual([]);
  await shot(page,'C-foreign-denied',{state:'intercepted403-no-foreign-tasks'});
  await page.goto('/?notificationId=series-notice&notificationFactory=series-factory&notificationRoute=tasks');
  await expect(page.getByRole('heading',{name:'Заявки',exact:true})).toBeVisible();
  expect(reads).toBe(6); expect(new URL(page.url()).search).toBe('');
  await page.reload(); await expect(page.getByRole('heading',{name:'Заявки',exact:true})).toBeVisible(); expect(reads).toBe(6);
  await open(page,'Уведомления'); denySource=true;
  await card.getByRole('button',{name:'Открыть',exact:true}).click();
  await expect(page.locator('.error-state')).toContainText('Доступ к связанному разделу больше не действует.');
  await expect(page.getByRole('heading',{name:'Уведомления',exact:true})).toBeVisible();expect(reads).toBe(7);
  expect(unknown).toEqual([]); expect(errors).toEqual([]);
});

async function modalState(page: Page) {
  return page.locator('.action-modal-backdrop form').evaluate(form=>{
    const key=Object.keys(form).find(k=>k.startsWith('__reactFiber'))!;
    let fiber=(form as any)[key];
    while(fiber&&!fiber.memoizedProps?.fields) fiber=fiber.return;
    const props=fiber?.memoizedProps;
    return {title:props?.title,defaults:props?.fields?.map((f:any)=>({name:f.name,type:f.type,defaultValue:f.defaultValue})),firstHook:fiber?.memoizedState?.memoizedState,dom:[...form.querySelectorAll<HTMLInputElement>('input,textarea,select')].map(e=>({name:e.name,value:e.value,checked:e.checked})),active:document.activeElement?.tagName};
  });
}
test('Series D controlled async baseline and real Browser Back',async({page})=>{
  test.setTimeout(120000);
  let armed=false; let release:(()=>void)|undefined; let now=Date.parse('2026-09-15T00:00:00Z');
  await isolate(page,{replies:async(route,p)=>{
    if(p==='/health') {
      if(armed) {armed=false; await new Promise<void>(resolve=>{release=resolve;}); now+=120000;}
      await json(route,{status:'ok',timestamp:new Date(now).toISOString()});return true;
    }
    return linkedReplies(route,p);
  }});
  await page.goto('/'); await open(page,'Линии');
  // Arm only after initial Lines load (including health) finished; hold the action request, not bootstrap.
  await expect(page.locator('.line-card').getByRole('button',{name:'Простой',exact:true})).toBeVisible();
  const sizes=before?[1440,390]:[1440,1440,1440,390,390,390,360,430];
  for(const [i,width] of sizes.entries()) {
    await page.setViewportSize({width,height:844});
    armed=true; release=undefined;
    await page.locator('.line-card').getByRole('button',{name:'Простой',exact:true}).click();
    const modal=page.locator('.action-modal-backdrop'); await expect(modal).toBeVisible();
    await expect.poll(()=>Boolean(release)).toBe(true);
    const initial=await modalState(page);
    release!();
    await expect.poll(async()=>JSON.stringify((await modalState(page)).defaults)).not.toBe(JSON.stringify(initial.defaults));
    const arrived=await modalState(page);
    records.push({case:'D-async-arrival',width,iteration:i,initial,arrived});save();
    if(i===0||width!==sizes[i-1]) await shot(page,`D-${width}-untouched-arrival-${i}`,{state:'untouched-after-async',initial,arrived});
    await page.goBack();
    if(before) {
      await expect(page.getByRole('heading',{name:'Изменения не сохранены',exact:true})).toBeVisible();
      await shot(page,`D-${width}-false-dirty-${i}`,{state:'FALSE_DIRTY_REPRODUCED'});
      await page.getByRole('button',{name:'Закрыть без сохранения',exact:true}).click();
    } else await expect(modal).toBeHidden();
    await expect(modal).toBeHidden();
    await page.locator('.line-card').getByRole('button',{name:'Простой',exact:true}).click();
    await modal.getByLabel('Комментарий',{exact:true}).fill(`Черновик ${i}`);
    await modal.getByLabel('Время события',{exact:true}).selectOption('CUSTOM');
    await page.goBack(); // Focus-first contract: blur, then logical layer Back.
    await expect(modal).toBeVisible();
    await page.goBack();
    await expect(page.getByRole('heading',{name:'Изменения не сохранены',exact:true})).toBeVisible();
    await page.getByRole('button',{name:'Остаться',exact:true}).click();
    await expect(modal.getByLabel('Комментарий',{exact:true})).toHaveValue(`Черновик ${i}`);
    await expect(modal.getByLabel('Время события',{exact:true})).toHaveValue('CUSTOM');
    await page.goBack();
    await page.getByRole('button',{name:'Закрыть без сохранения',exact:true}).click();
    await expect(modal).toBeHidden();
    expect(await page.evaluate(()=>getComputedStyle(document.body).overflow)).not.toBe('hidden');
  }
  expect(unknown).toEqual([]); expect(errors).toEqual([]);
});

test('Series D real nested People number checkbox and reopen',async({page})=>{
  test.setTimeout(60000);
  const worker={...person,role:'WORKER',employeeState:'AVAILABLE',skills:[{id:'series-skill',lineId:'series-line',lineName:'Линия фасовки',positionId:'series-position',positionName:'Упаковщик',experienceCount:4,level:'Подтверждён',color:'GREEN',recommended:true}]};
  await isolate(page,{replies:async(route,p)=>{
    if(p==='/people') {await json(route,{people:[worker],groups:{}});return true;}
    if(p==='/people/series-person') {await json(route,worker);return true;}
    return linkedReplies(route,p);
  }}); await page.goto('/');
  for(const width of [1440,390]) {
    await page.setViewportSize({width,height:844}); await open(page,'Люди');
    await page.locator('.people-compact-row').first().click();
    await page.getByRole('button',{name:/Навыки по линиям/}).click();
    await page.getByRole('button',{name:'Изменить',exact:true}).click();
    const modal=page.locator('.action-modal-backdrop');
    await expect(modal.getByLabel('Фактический опыт',{exact:true})).toHaveValue('4');
    await expect(modal.getByLabel('Навык активен',{exact:true})).toBeChecked();
    await page.goBack(); await expect(modal).toBeVisible(); // autofocus blur
    await page.goBack(); await expect(modal).toBeHidden();
    await expect(page.locator('.profile-card')).toBeVisible();
    await page.getByRole('button',{name:'Изменить',exact:true}).click();
    await modal.getByLabel('Навык активен',{exact:true}).uncheck();
    await page.goBack(); await page.goBack();
    await expect(page.getByRole('heading',{name:'Изменения не сохранены',exact:true})).toBeVisible();
    await page.getByRole('button',{name:'Остаться',exact:true}).click();
    await expect(modal.getByLabel('Навык активен',{exact:true})).not.toBeChecked();
    await shot(page,`D-${width}-nested-checkbox-preserved`,{state:'real-People-consumer-stay',role:'ADMIN'});
    await page.goBack(); await page.getByRole('button',{name:'Закрыть без сохранения',exact:true}).click();
    await expect(modal).toBeHidden(); await expect(page.locator('.profile-card')).toBeVisible();
    await page.getByRole('button',{name:'Изменить',exact:true}).click();
    await expect(modal.getByLabel('Навык активен',{exact:true})).toBeChecked();
    await page.goBack(); await page.goBack(); await expect(modal).toBeHidden();
    await page.goBack(); await expect(page.locator('.profile-card')).toBeHidden();
  }
  expect(unknown).toEqual([]); expect(errors).toEqual([]);
});

test('Series E pending task cannot cross factory switch',async({page})=>{
  test.setTimeout(60000); let release:(()=>void)|undefined;
  const factories=[{id:'series-factory',name:'Изолированный завод',code:'SERIES',role:'ADMIN',isGuest:false},{id:'series-second',name:'Вторая площадка',code:'SECOND',role:'ADMIN',isGuest:false}];
  await isolate(page,{replies:async(route,p)=>{
    const factory=route.request().headers()['x-factory-id']||'series-factory';
    if(p==='/auth/me') {await json(route,{userId:'series-user',selectedFactoryId:factory,role:'ADMIN',isAdmin:true,isGuest:false,permissions,availableFactories:factories,displayName:'Проверка интерфейса'});return true;}
    if(p==='/tasks/board') {
      if(factory==='series-factory') await new Promise<void>(resolve=>{release=resolve;});
      await json(route,{NEW:[],IN_PROGRESS:factory==='series-factory'?[taskRow]:[],LONG:[],DONE:[]});return true;
    }
    return linkedReplies(route,p);
  }});
  await page.setViewportSize({width:1440,height:720}); await page.goto('/');
  await open(page,'Люди'); await page.locator('.people-compact-row').first().click();
  await page.getByRole('button',{name:'Посмотреть заявку',exact:true}).click();
  await expect.poll(()=>Boolean(release)).toBe(true);
  await page.locator('.nav-settings-button').click();
  await page.getByRole('button',{name:'Сменить завод',exact:true}).click();
  await page.getByRole('button',{name:/Вторая площадка/}).click();
  await expect(page.locator('.brand-name')).toHaveText('Вторая площадка');
  release!();
  await open(page,'Заявки');
  await expect(page.getByRole('heading',{name:'Заявки',exact:true})).toBeVisible();
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(page.getByText(taskRow.description,{exact:true})).toBeHidden();
  await shot(page,'E-factory-no-stale-task',{state:'old-board-arrived-after-context-change'});
  expect(network.filter(x=>x.path==='/tasks/series-task'&&x.factory==='series-second')).toEqual([]);
  expect(unknown).toEqual([]); expect(errors).toEqual([]);
});

test('Series E actual browser notification callback on isolated websocket',async({page})=>{
  let socket:WebSocketRoute|undefined; let reads=0;
  await isolate(page,{socket:s=>{socket=s;},replies:async(route,p)=>{
    if(p==='/notifications/series-browser/read'&&route.request().method()==='POST') {reads++;await json(route,{ok:true});return true;}
    return linkedReplies(route,p);
  }});
  await page.addInitScript(()=>{
    localStorage.setItem('zavod.browserNotificationsEnabled','1');
    (window as any).__seriesNotifications=[];
    Object.defineProperty(window,'Notification',{configurable:true,value:class {
      static permission='granted'; onclick:Function|null=null; data:any;
      constructor(public title:string,options:any) {this.data=options.data;(window as any).__seriesNotifications.push(this);}
      close() {}
    }});
  });
  await page.goto('/'); await expect.poll(()=>Boolean(socket)).toBe(true);
  socket!.send(JSON.stringify({type:'notification_created',payload:{id:'series-browser',factoryId:'series-factory',sourceRoute:'tasks',title:'Событие из адаптера',message:'Изолированный канал',severity:'WARNING',createdAt:'2026-09-15T00:00:00Z',readAt:null}}));
  await expect.poll(()=>page.evaluate(()=>(window as any).__seriesNotifications.length)).toBe(1);
  const data=await page.evaluate(()=>{const notice=(window as any).__seriesNotifications[0];notice.onclick();return notice.data;});
  expect(data).toEqual({notificationId:'series-browser',factoryId:'series-factory',sourceRoute:'tasks'});
  await expect(page.getByRole('heading',{name:'Заявки',exact:true})).toBeVisible();expect(reads).toBe(1);
  await page.goBack(); await expect(page.getByRole('heading',{name:'Заявки',exact:true})).toBeHidden();
  await shot(page,'E-browser-adapter-return',{state:'actual-product-callback-isolated-delivery'});
  expect(unknown).toEqual([]); expect(errors).toEqual([]);
});

test('Series E non-default People filters survive linked task return',async({page})=>{
  test.setTimeout(60000);
  await isolate(page,{replies:async(route,p)=>{
    if(p==='/people/search') {await json(route,{queryAccepted:true,message:'Изолированный поиск',context:null,results:[]});return true;}
    return linkedReplies(route,p);
  }}); await page.goto('/');
  for(const width of [1440,390]) {
    await page.setViewportSize({width,height:844});await open(page,'Люди');
    await page.locator('.people-shift-tabs').getByRole('button',{name:'На смене',exact:true}).click();
    await page.getByRole('button',{name:'Поиск и фильтры',exact:true}).click();
    const sheet=page.locator('.premium-sheet');
    await page.locator('.people-category-tabs').getByRole('button',{name:'Службы',exact:true}).click();
    await page.locator('.people-search-panel input').fill('Сервис');
    await page.getByRole('button',{name:'Показать',exact:true}).click();
    await page.locator('.people-compact-row').first().click();
    await page.getByRole('button',{name:'Посмотреть заявку',exact:true}).click();
    await expect(page.getByRole('dialog')).toContainText(taskRow.description);
    await page.goBack();await expect(page.getByRole('dialog')).toBeHidden();
    await page.goBack();await expect(page.locator('.profile-card')).toBeVisible();
    await page.goBack();await expect(page.locator('.profile-card')).toBeHidden();
    await expect(page.locator('.people-shift-tabs').getByRole('button',{name:'На смене',exact:true})).toHaveAttribute('aria-pressed','true');
    await page.getByRole('button',{name:'Поиск и фильтры',exact:true}).click();
    await expect(page.locator('.people-category-tabs').getByRole('button',{name:'Службы',exact:true})).toHaveAttribute('aria-pressed','true');
    await expect(page.locator('.people-search-panel input')).toHaveValue('Сервис');
    await shot(page,`E-${width}-source-filters-restored`,{state:'non-default-return',role:'ADMIN'});
    await page.getByRole('button',{name:'Показать',exact:true}).click();
    await open(page,'Заявки');
  }
  expect(unknown).toEqual([]);expect(errors).toEqual([]);
});

test('Series E long ordinary page end hit-test and nav text ranges',async({page})=>{
  test.setTimeout(60000);
  await isolate(page,{replies:async(route,p)=>{
    if(p==='/notifications') {await json(route,Array.from({length:12},(_,i)=>({id:`long-${i}`,factoryId:'series-factory',sourceRoute:'tasks',title:`Событие ${i+1}`,message:'Проверка доступности последнего действия длинного списка уведомлений.',severity:'INFO',createdAt:'2026-09-15T00:00:00Z',readAt:null})));return true;}
    return linkedReplies(route,p);
  }});await page.goto('/');
  for(const theme of ['dark','gray','light']) {
    await page.setViewportSize({width:1440,height:720});
    await page.locator('.nav-settings-button').click();
    await page.getByRole('button',{name:({dark:'Тёмная',gray:'Серая',light:'Светлая'})[theme],exact:true}).click();
    await page.goBack();await expect(page.locator('.mobile-nav-sheet h2')).toHaveText('Ещё');
    await page.goBack();await expect(page.locator('.mobile-sheet-backdrop')).toBeHidden();
    await open(page,'Уведомления'); await expect(page.locator('.notification-card')).toHaveCount(12);
    for(const width of [1440,360,390,430]) {
      await page.setViewportSize({width,height:width===360?640:720});await end(page);
      const target=page.locator('.notification-card').last().getByRole('button',{name:'Открыть',exact:true});
      const hit=await target.evaluate(button=>{const r=button.getBoundingClientRect();const e=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return {rect:r.toJSON(),hit:e===button||button.contains(e)};});
      const g=await geometry(page);expect(hit.hit).toBe(true);expect(hit.rect.bottom).toBeLessThanOrEqual(g.nav.top);
      if(width===1440) for(const label of g.labels) for(const line of label.lines) {expect(line.bottom).toBeLessThanOrEqual(g.nav.bottom);expect(line.left).toBeGreaterThanOrEqual(label.rect.left);expect(line.right).toBeLessThanOrEqual(label.rect.right);}
      records.push({case:'long-page-end',theme,width,hit,geometry:g});save();
      if(width===1440||width===360) await shot(page,`E-long-${theme}-${width}`,{state:'ordinary-scroll-last-control',hit,geometry:g});
    }
  }
  expect(unknown).toEqual([]);expect(errors).toEqual([]);
});

test('Series E affected timeline task writer returns exact selected shift',async({page})=>{
  test.setTimeout(60000);
  await isolate(page,{replies:async(route,p)=>{
    if(p==='/lines/series-line/timeline') {await json(route,{line:{id:lineRow.id,name:lineRow.name},shift:{shiftDate:'2026-09-14',shiftType:'NIGHT',startsAt:'2026-09-14T17:00:00Z',endsAt:'2026-09-15T05:00:00Z',isCurrent:false},navigation:{previous:{shiftDate:'2026-09-14',shiftType:'DAY'},next:null},currentStatus:'WORK',summary:{workDurationMs:0,downtimeDurationMs:0,stoppedDurationMs:0,washDurationMs:0,defrostDurationMs:0,linkedTaskCount:1,averageTaskReactionMs:0},events:[{id:'series-timeline-event',kind:'TASK',title:'Заявка по датчику',description:'Связанная заявка',occurredAt:'2026-09-14T18:00:00Z',durationMs:0,status:'IN_PROGRESS',sourceType:'TASK',sourceId:taskRow.id,canOpen:true}],diagnostics:[]});return true;}
    return linkedReplies(route,p);
  }});await page.goto('/');
  for(const width of [1440,390]) {
    await page.setViewportSize({width,height:844});await open(page,'Линии');
    await page.locator('.line-card').getByRole('button',{name:lineRow.name,exact:true}).click();
    await page.getByRole('button',{name:'История линии',exact:true}).click();
    const timeline=page.locator('.line-timeline-list');await expect(timeline).toContainText('Заявка по датчику');
    await timeline.getByRole('button',{name:'Открыть',exact:true}).click();
    await expect(page.getByRole('dialog')).toContainText(taskRow.description);
    await page.goBack();await expect(page.getByRole('dialog')).toBeHidden();
    await page.goBack();await expect(timeline).toContainText('Заявка по датчику');
    await shot(page,`E-${width}-timeline-return`,{state:'night-shift-timeline-parent-restored'});
    await page.goBack();await expect(timeline).toBeHidden();
    await page.goBack();
    await open(page,'Заявки');
  }
  expect(unknown).toEqual([]);expect(errors).toEqual([]);
});
