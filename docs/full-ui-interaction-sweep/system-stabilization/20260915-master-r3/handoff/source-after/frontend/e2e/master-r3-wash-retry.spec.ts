import {test,expect} from '@playwright/test';
import {isolate,linkedReplies,json,open,permissions,unknown,errors,records,save,installEvidenceHooks} from './helpers/frontend-series';
installEvidenceHooks();
test('R3-C2 actual Wash request retry retains operation ID within one form attempt',async({page})=>{
 const commands:any[]=[];let unavailable=true;
 await isolate(page,{role:'MASTER',granted:[...permissions,'wash.control.create'],socket:()=>{},replies:async(r,p)=>{
  if(p==='/wash/requests'&&r.request().method()==='POST'){commands.push(r.request().postDataJSON());await json(r,unavailable?{message:'Ответ временно недоступен'}:{id:'r3-request'},unavailable?503:201);return true;}
  if(p==='/wash/requests'){await json(r,[]);return true;}
  return linkedReplies(r,p);
 }});await page.goto('/');await open(page,'Мойка');await page.getByRole('button',{name:'Создать задание',exact:true}).click();
 await page.getByLabel('Что нужно помыть',{exact:true}).selectOption('OTHER');await page.getByLabel('Другой объект',{exact:true}).fill('Стол упаковки');await page.getByLabel('Описание работ',{exact:true}).fill('Обработать поверхность');
 await page.getByRole('button',{name:'Подтвердить',exact:true}).click();await expect(page.locator('.action-modal-backdrop .error-state')).toBeVisible();
 unavailable=false;await page.getByRole('button',{name:'Подтвердить',exact:true}).click();await expect(page.locator('.action-modal-backdrop')).toHaveCount(0);
 expect(commands).toHaveLength(2);expect(commands[1].operationId).toBe(commands[0].operationId);expect(commands[1]).toEqual(commands[0]);expect(unknown).toEqual([]);expect(errors).toEqual([]);
 records.push({producer:'WashScreen request actual serialized attempts',sameKey:true,backend:'response fault adapter, not a SQL commit proof',commands});save();
});
for(const action of ['start','message','issue','complete'] as const)test(`R3-C2 actual Wash ${action} retry retains operation ID`,async({page})=>{
 const commands:any[]=[];let unavailable=true;
 const session={id:'r3-wash',objectName:'Зона упаковки',targetType:'OTHER',active:true,startedAt:'2026-09-15T08:00:00Z',events:[],messages:[],issues:[],attachments:[],participants:[],controlItems:[],okkReviews:[]};
 const endpoint=action==='start'?'/wash/start':`/wash/r3-wash/${action==='issue'?'issues':action}`;
 await isolate(page,{role:'MASTER',granted:[...permissions,'wash.manage','wash.message.create','wash.issue.create'],socket:()=>{},replies:async(r,p)=>{
  if(p===endpoint&&r.request().method()==='POST'){commands.push(r.request().postDataJSON());await json(r,unavailable?{message:'Ответ временно недоступен'}:{id:'r3-result'},unavailable?503:201);return true;}
  if(p==='/wash'){await json(r,action==='start'?[]:[session]);return true;}if(p==='/wash/r3-wash'){await json(r,session);return true;}if(p==='/wash/requests'){await json(r,[]);return true;}return linkedReplies(r,p);
 }});await page.goto('/');await open(page,'Мойка');
 if(action==='start'){await page.getByRole('button',{name:'Начать мойку',exact:true}).click();await page.getByRole('button',{name:'Другое',exact:true}).click();await page.getByLabel('Что моют?',{exact:true}).fill('Зона упаковки');}
 else{await page.locator('.wash-session-card').getByRole('button').first().click();await page.getByRole('button',{name:action==='message'?'Фото / комментарий':action==='issue'?'Проблема':'Завершить мойку',exact:true}).click();if(action==='message')await page.getByLabel('Комментарий',{exact:true}).fill('Поверхность обработана');if(action==='issue'){await page.getByLabel('Коротко что не так',{exact:true}).fill('Следы загрязнения');await page.getByLabel('Описание',{exact:true}).fill('Нужна повторная обработка');}}
 const submit=page.locator('.modal-backdrop').getByRole('button',{name:action==='start'?'Начать мойку':action==='complete'?'Завершить мойку':'Подтвердить',exact:true});
 await submit.click();await expect(page.locator('.modal-backdrop .error-state')).toBeVisible();unavailable=false;await submit.click();await expect(page.locator('.modal-backdrop')).toHaveCount(0);
 expect(commands).toHaveLength(2);expect(commands[1]).toEqual(commands[0]);expect(unknown).toEqual([]);expect(errors).toEqual([]);records.push({producer:`WashScreen ${action}`,commands,scope:'actual UI serialization; no database commit'});save();
});
