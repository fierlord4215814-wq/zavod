import { expect, test, Page, Route, WebSocketRoute } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const root = path.resolve(__dirname, '../../../docs/full-ui-interaction-sweep', process.env.MASTER_BATCH ? `system-stabilization/${process.env.MASTER_BATCH}` : 'frontend-series/20260915-autonomous-frontend');
const run = process.env.FRONTEND_SERIES_RUN || `run-${Date.now()}`;
let out = path.join(root, 'evidence', run);
let currentTest = 'initial';
export function installEvidenceHooks() {
test.beforeEach(async ({}, info) => {
  currentTest = `${crypto.createHash('sha256').update(info.title).digest('hex').slice(0,12)}-retry${info.retry}`;
  out = path.join(root, 'evidence', run, currentTest);
  if(fs.existsSync(out)) throw new Error(`Run/test evidence already exists: ${out}`);
  records.length=0; network.length=0; errors.length=0; unknown.length=0;
});
test.afterEach(async ({},info) => { records.push({test:info.title,status:info.status,error:info.error?.message}); save(); });
}
export const before = process.env.FRONTEND_SERIES_PHASE === 'before';
const sha = (data: Buffer) => crypto.createHash('sha256').update(data).digest('hex');
export const permissions = ['shift.self.read','shift.current.read','shift.future.read','people.profile.read','people.read','admin.overview.read','admin.read','config.read','lines.read','tasks.read','wash.read','okk.read','stock.read','orders.read','checklists.templates.read','checklists.runs.self','checklists.runs.read','returns.publication.read','shift-log.read','shift-log.archive.read','defrost.read','chats.read','announcements.read','announcements.archive.read','notifications.read','ops.overview.read','ops.events.read','ops.audit.read','ops.statistics.read'];
export const records: any[] = [];
export const network: any[] = [];
export const errors: string[] = [];
export const unknown: string[] = [];
const identities = new WeakMap<Page,string>();
export const json = (route: Route, body: unknown, status = 200) => route.fulfill({status, contentType:'application/json', body:JSON.stringify(body)});
type Options = { role?: 'ADMIN' | 'WORKER' | 'TECH_MECHANIC' | 'MASTER'; identity?: {userId:string;factoryId:string}; granted?: string[]; theme?: string; screen?: string; socket?: (socket: WebSocketRoute)=>void; replies?: (route: Route, pathname: string) => Promise<boolean> };

// DTOs reused from the established shift-readonly-profile-and-history-choice fixture.
const shiftCard = (type: string) => ({key:`2026-09-07:${type}:self`,shiftDate:'2026-09-07',shiftType:type,shiftTypeLabel:type==='DAY'?'День':'Ночь',title:type==='DAY'?'Дневная смена 7 сентября':'Ночная смена 7 сентября',masterLabel:'Мастер смены',masters:['Мастер смены'],peopleCount:1,lineCount:1,downtimeCount:0,taskCount:0,washCount:0,importantShiftLogs:0,readOnly:true});

export async function isolate(page: Page, options: Options = {}) {
  identities.set(page,options.role||'ADMIN');
  page.on('pageerror', e => errors.push(e.message));
  await page.routeWebSocket('**', socket => { network.push({kind:options.socket?'websocket-isolated':'websocket-blocked',url:socket.url()}); if(options.socket) options.socket(socket); else socket.close(); });
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin === 'http://127.0.0.1:5173' && (url.pathname === '/' || /^\/(assets\/|pwa-icon-|favicon|manifest)/.test(url.pathname))) return route.continue();
    const p = url.pathname.replace(/^\/api/, '');
    const method = route.request().method();
    network.push({method,path:p, factory:route.request().headers()['x-factory-id']});
    if (url.origin === 'http://127.0.0.1:5173' && options.replies && await options.replies(route,p)) return;
    if (url.origin !== 'http://127.0.0.1:5173' || method !== 'GET') {
      unknown.push(`${method} ${url.origin}${p}`); return route.abort('blockedbyclient');
    }
    if (p === '/auth/me') return json(route,{userId:'series-user',selectedFactoryId:'series-factory',role:options.role||'ADMIN',departmentId:'series-department',permissions:options.granted??(options.role==='WORKER'?['shift.self.read','tasks.read','notifications.read']:permissions),isAdmin:!options.role||options.role==='ADMIN',isGuest:false,displayName:'Проверка интерфейса',availableFactories:[{id:'series-factory',name:'Изолированный завод',role:options.role||'ADMIN',isGuest:false}]});
    if (p === '/notifications/push/status') return json(route,{available:false,publicKey:null,reason:'Изолированная проверка',activeSubscriptions:0});
    if (p === '/health') return json(route,{status:'ok'});
    if (p === '/auth/assignment-request') return json(route,{status:'WAITING_ASSIGNMENT',request:null,options:{assignments:[]}});
    if (p === '/shift/timeline') return json(route,{current:{shiftDate:'2026-09-15',targetShiftDate:'2026-09-15',shiftType:'DAY',label:'Текущая смена'},next:{shiftDate:'2026-09-15',targetShiftDate:'2026-09-15',shiftType:'NIGHT',label:'Следующая смена'},future:[],past:[]});
    if (p === '/shift/me') return json(route,{user:null,currentShift:null,assignment:null,canConfirm:false});
    if (p === '/shift-log/handover/previous') return json(route,null);
    if (p === '/shift-log/handover/availability') return json(route,{available:false});
    if (p === '/notifications/unread-count') return json(route,{count:0});
    if (p === '/announcements/current') return json(route,{total:0,current:null,items:[]});
    if (p === '/tasks/board') return json(route,{NEW:[],IN_PROGRESS:[],LONG:[],DONE:[]});
    if (p === '/people') return json(route,{people:[],groups:{}});
    if (p === '/shift/past') return json(route,{month:'2026-09',shifts:[shiftCard('DAY'),shiftCard('NIGHT')],sessions:[],assignments:[]});
    if (p.startsWith('/shift/past/')) {
      const type = decodeURIComponent(p).includes(':NIGHT:')?'NIGHT':'DAY';
      return json(route,{...shiftCard(type),timeRange:type==='DAY'?'08:00–20:00':'20:00–08:00',scope:'SELF',allowedActions:{},summary:{masters:['Мастер смены'],peopleCount:1,lineCount:1,downtimeCount:0,downtimeLabel:'0 мин',taskCount:0,washCount:0,importantShiftLogs:0},people:[],lines:[],downtime:[],tasks:[],washes:[],shiftLogs:[],tabs:['Обзор']});
    }
    if (['/notifications','/chats','/error-reports','/lines','/lines/shift-overview','/shift/people','/work-areas','/lines/downtime-reasons','/tasks','/tasks/assignees','/tasks/departments'].includes(p)) return json(route,[]);
    unknown.push(`${method} ${p}${url.search}`);
    return json(route,{message:'UNKNOWN_REQUEST_BLOCKED'},501);
  });
  await page.addInitScript(({theme,screen,identity}) => {
    // Playwright's block mode does not implement a registration response. Supply the
    // browser contract explicitly; no service worker/network/cache is actually started.
    const registration = Object.assign(new EventTarget(), {waiting:null,installing:null,active:null,scope:location.origin+'/',update:async()=>undefined,unregister:async()=>true});
    Object.defineProperty(navigator.serviceWorker, 'register', {configurable:true,value:async()=>registration});
    Object.defineProperty(navigator.serviceWorker, 'getRegistrations', {configurable:true,value:async()=>[]});
    if (!sessionStorage.getItem('series-initialized')) {
      localStorage.clear(); sessionStorage.clear();
      localStorage.setItem('zavod.authToken','isolated-series-token');
      localStorage.setItem('zavod.devUserId',identity.userId);
      localStorage.setItem('zavod.selectedFactoryId',identity.factoryId);
      localStorage.setItem('zavod.appearanceTheme',theme);
      sessionStorage.setItem(`zavod.session.route.${identity.userId}.${identity.factoryId}`,screen);
      localStorage.setItem(`zavod.quick-nav.${identity.userId}.${identity.factoryId}`,JSON.stringify(['Report','Situation','Tasks','ShiftHistory']));
      sessionStorage.setItem('series-initialized','1');
    }
  },{theme:options.theme||'dark',screen:options.screen||'Report',identity:options.identity??{userId:'series-user',factoryId:'series-factory'}});
}

export async function shot(page: Page, name: string, metadata: object = {}) {
  fs.mkdirSync(out,{recursive:true});
  if(process.env.FRONTEND_SERIES_CAPTURE==='0') {records.push({name,viewport:page.viewportSize(),state:'FINAL_RECHECK_NO_DUPLICATE_PNG',...metadata});save();return;}
  // Preserve native UI: wait for finite entrance animations, do not inject CSS or hide layers.
  await page.evaluate(async()=>{
    const animations=document.getAnimations().filter(a=>a.playState==='running'&&Number.isFinite(a.effect?.getComputedTiming().endTime));
    await Promise.all(animations.map(a=>a.finished.catch(()=>undefined)));
  });
  const file = `${String(records.length+1).padStart(3,'0')}-${name}.png`;
  const png = await page.screenshot({path:path.join(out,file),fullPage:false});
  records.push({file,sha256:sha(png),time:new Date().toISOString(),viewport:page.viewportSize(),theme:await page.locator('html').getAttribute('data-theme'),role:identities.get(page),build:await page.locator('script[src]').evaluateAll(nodes=>nodes.map(n=>n.getAttribute('src'))),review:'CAPTURED_NOT_REVIEWED',...metadata});
  save();
}
export function save() {
  fs.mkdirSync(out,{recursive:true});
  fs.writeFileSync(path.join(out,'runtime.json'),JSON.stringify({run,currentTest,before,records,network,unknown,errors,realBackendWrites:0,source:{App:sha(fs.readFileSync(path.resolve(__dirname,'../../src/App.tsx'))),styles:sha(fs.readFileSync(path.resolve(__dirname,'../../src/styles.css'))),harness:sha(fs.readFileSync(__filename))}},null,2));
}
export async function open(page: Page, title: string) {
  await expect(page.locator('.bottom-nav, .mobile-quick-nav').filter({visible:true}).first()).toBeVisible();
  const button = page.locator('.bottom-nav button, .mobile-quick-nav button').filter({hasText:title}).filter({visible:true});
  if (await button.count()) await button.first().click();
  else { await page.getByRole('button',{name:'Ещё',exact:true}).click(); await page.locator('.mobile-nav-sheet button').filter({hasText:title}).first().click(); }
}
export async function end(page: Page) {
  await page.mouse.move(30,200);
  await page.mouse.wheel(0,100000);
  await expect.poll(() => page.evaluate(() => Math.abs(document.documentElement.scrollHeight-innerHeight-scrollY))).toBeLessThanOrEqual(2);
}
export async function geometry(page: Page) {
  return page.evaluate(() => {
    const nav = [...document.querySelectorAll<HTMLElement>('.bottom-nav,.mobile-quick-nav')].find(e=>e.getBoundingClientRect().height>0)!;
    const r=nav.getBoundingClientRect();
    const labels=[...nav.querySelectorAll('button')].map(b=>{
      const rect=b.getBoundingClientRect();
      const label=b.querySelector('span:not(.nav-icon):not(.nav-badge)');
      const range=document.createRange(); if(label) range.selectNodeContents(label);
      return {text:label?.textContent,rect:rect.toJSON(),lines:[...range.getClientRects()].map(x=>x.toJSON()),font:getComputedStyle(b).fontSize};
    });
    return {nav:r.toJSON(),navScroll:nav.scrollHeight,navClient:nav.clientHeight,labels,padding:getComputedStyle(document.querySelector('.app-shell')!).paddingBottom,overflow:document.documentElement.scrollWidth-innerWidth};
  });
}

export const serviceTask = {state:'ON_TASK',label:'В работе',taskId:'series-task',title:'Проверка датчика линии',lineName:'Линия фасовки'};
export const person = {userId:'series-person',id:'series-person',displayName:'Сервисов Сергей Сергеевич',role:'TECH_MECHANIC',departmentId:'series-department',departmentName:'Механики',employeeState:'ON_TASK',phoneLabel:'Не указан',skillsSummary:'Механик',onShift:true,serviceTaskStatus:serviceTask,skills:[],notes:[],factoryAccesses:[],availableActions:[],currentAssignment:null};
export const taskRow = {id:'series-task',factoryId:'series-factory',description:'Проверка датчика линии',title:'Проверка датчика линии',status:'IN_PROGRESS',type:'URGENT',lineId:'series-line',lineName:'Линия фасовки',createdAt:'2026-09-15T00:00:00Z',startedAt:'2026-09-15T00:05:00Z',assignedToId:'series-person',assignedToName:person.displayName,recipientDepartments:[],comments:[],attachments:[],reads:[]};
export const taskSummary = {taskId:taskRow.id,taskStatus:taskRow.status,taskStatusLabel:'В работе',taskType:'URGENT',taskTypeLabel:'Срочная',serviceLabel:'Механики',assigneeDisplayName:person.displayName,hasAssignee:true,createdAt:taskRow.createdAt,startedAt:taskRow.startedAt,deadlineAt:null,overdue:false,sourceKind:'LINE',sourceLabel:'Заявка по линии',canOpen:true,additionalActiveCount:0};
export const lineRow = {id:'series-line',name:'Линия фасовки',status:'WORK',operationalState:'RUNNING',activeWorkersCount:1,activeTasksCount:1,activeTaskSummary:taskSummary,activeAssignments:[],positions:[],shortageSummary:[]};
export async function linkedReplies(route: Route,p: string) {
  if(route.request().method()!=='GET') return false;
  let body: unknown;
  if(p==='/people') body={people:[person],groups:{}};
  else if(p==='/people/series-person') body=person;
  else if(p==='/people/series-person/profile') body={...person,employeeState:'AVAILABLE',sections:{skills:'Механик',recommendations:'Допущен к работе',comments:null},factoryAccessSummary:{factoryName:'Изолированный завод',role:person.role,isActive:true}};
  else if(p==='/admin/users/series-person/password-reset/preview') body={allowed:false,reason:'Изолированная проверка',passwordResetRequired:false};
  else if(p==='/shift/people') body=[{...person,employeeState:'AVAILABLE'}];
  else if(p==='/lines'||p==='/lines/shift-overview') body=[lineRow];
  else if(p==='/lines/series-line/dashboard') body={line:lineRow,assignedCount:1,requiredCount:1,structureConfigured:true,structureMessage:null,assignmentsByPosition:[],withoutPosition:[],activeTasks:[taskSummary],activeWash:[],recentEvents:[]};
  else if(p==='/tasks/board') body={NEW:[],IN_PROGRESS:[taskRow],LONG:[],DONE:[]};
  else if(p==='/tasks/series-task') body=taskRow;
  else if(p==='/tasks/recipient-departments'||p==='/tasks/assignee-candidates'||p==='/wash') body=[];
  else if(p==='/archive/options') body={lines:[lineRow]};
  else if(p==='/admin/task-settings') body={taskAttachmentsEnabled:true};
  else if(p==='/tasks/archive/summary') body={metrics:{total:0,open:0,closed:0,overdueLong:0},tasks:[],items:[],byDepartment:[],byLine:[]};
  else return false;
  await json(route,body); return true;
}
