const {assert,chromium,login,api}=require('../local-02/harness.cjs');
const {png,sha,download}=require('../local-02/files.cjs');
const {ownPrisma,verifyOwnDb}=require('../local-02/own-db.cjs');
const fs=require('node:fs'),path=require('node:path');
const titles=['Вход/тамбур','Проход','Пол участка','Рабочий стол','Мойка рук','Мойка инвентаря','Стеллаж','Контейнер отходов','Дверь холодильной зоны','Место уборочного инвентаря'];
const name='Учебный обход десяти точек LOCAL03';
const output=path.join(__dirname,'checklist-ui.json');
const ev=fs.existsSync(output)?JSON.parse(fs.readFileSync(output)):{name,completed:[],http:[]};
const save=()=>fs.writeFileSync(output,JSON.stringify(ev,null,2));
async function photo(locator,index){await locator.locator('input[type=file][accept="image/*"]').last().setInputFiles({name:`Учебное-фото-${index}.png`,mimeType:'image/png',buffer:png(index)});}
async function main(){const browser=await chromium.launch({channel:'msedge',headless:true});const db=ownPrisma();try{
 await verifyOwnDb(db);const admin=await login(browser,'ADMIN'),okk=await login(browser,'OKK');
 for(const a of [admin,okk]) {a.page.on('response',r=>{const p=new URL(r.url()).pathname;if(r.request().method()!=='GET'&&p.startsWith('/api/'))ev.http.push({path:p,status:r.status(),method:r.request().method()});});await a.page.getByRole('button',{name:'Чек-листы',exact:true}).click();await a.page.locator('.checklists-screen').waitFor();}
 await okk.page.locator('.checklist-kpi-strip').getByRole('button',{name:/Доступные/}).click();
 await admin.page.getByRole('button',{name:/Управление шаблонами/}).click();
 if(!ev.templateId){
  await admin.page.getByRole('button',{name:'Создать шаблон',exact:true}).click();const builder=admin.page.locator('.checklist-template-builder-sheet');
  await builder.getByLabel('Название',{exact:true}).fill(name);await builder.locator('.checklist-builder-section').filter({hasText:'Основное'}).first().locator('select').first().selectOption(okk.me.departmentId);await builder.getByRole('button',{name:'Общий для отдела',exact:true}).click();
  const frequency=builder.locator('.checklist-builder-section').filter({hasText:'Периодичность'}).first();await frequency.locator('select').first().selectOption('MANUAL');await frequency.locator('select').last().selectOption('OKK');
  for(let i=0;i<10;i++){await builder.getByRole('button',{name:'Добавить пункт',exact:true}).click();const item=admin.page.getByRole('dialog').filter({hasText:'Название пункта'}).last();await item.getByLabel('Название пункта',{exact:true}).fill(titles[i]);await item.locator('select').first().selectOption(i===0?'YES_NO':'REQUIRED_PHOTO');if(i===0){await item.getByLabel('Требовать фото',{exact:true}).check();await item.getByLabel('Требовать комментарий',{exact:true}).check();}await photo(item.locator('.checklist-reference-editor'),30+i);await item.getByRole('button',{name:'Сохранить',exact:true}).click();}
  await builder.screenshot({path:path.join(__dirname,'checklist-10-builder.png')});const t=Date.now();await builder.getByRole('button',{name:'Сохранить шаблон',exact:true}).click();await builder.waitFor({state:'hidden'});
  await okk.page.locator('.checklist-work-card.available').filter({hasText:name}).waitFor({timeout:18000});ev.templateSecondUiMs=Date.now()-t;
  const template=(await api(admin.page,'GET','/checklists/templates/library')).body.find(t=>t.name===name);assert.equal(template.rows.length,10);ev.templateId=template.id;ev.references=template.rows.map(r=>({rowId:r.id,id:r.referencePhoto.id}));save();
 }
 if(!ev.runId){const card=okk.page.locator('.checklist-work-card.available').filter({hasText:name});await card.getByRole('button',{name:'Взять в работу',exact:true}).click();const dialog=okk.page.getByRole('dialog').filter({hasText:name}).last();const [r]=await Promise.all([okk.page.waitForResponse(r=>r.url().endsWith('/api/checklists/runs/start')&&r.request().method()==='POST'),dialog.getByRole('button',{name:'Взять в работу',exact:true}).click()]);assert.equal(r.status(),201);ev.runId=(await r.json()).id;save();}
 else {const run=(await api(okk.page,'GET',`/checklists/runs/${ev.runId}`)).body;if(run.status!=='CLOSED'){await okk.page.locator('.checklist-kpi-strip').getByRole('button',{name:/В работе/}).click();await okk.page.locator('.checklist-work-card').filter({hasText:name}).getByRole('button',{name:/Продолжить|Открыть/}).click();}}
 let current=(await api(okk.page,'GET',`/checklists/runs/${ev.runId}`)).body;
 const runner=okk.page.locator('.guided-run-modal');
 if(current.status!=='CLOSED'){
  await runner.waitFor();
  for(let i=0;i<10;i++){
   current=(await api(okk.page,'GET',`/checklists/runs/${ev.runId}`)).body;if(current.rows[i].status!=='PENDING')continue;
   if(!await runner.locator('.guided-row-heading').filter({hasText:titles[i]}).isVisible()){await runner.getByRole('button',{name:'План чек-листа',exact:true}).click();await runner.locator('.list-stack .list-row').filter({hasText:titles[i]}).click();}await runner.locator('.guided-row-heading').filter({hasText:titles[i]}).waitFor();
   if(i===0){await runner.getByRole('button',{name:'Нет',exact:true}).click();if(await runner.getByRole('button',{name:'Далее: фото',exact:true}).isVisible())await runner.getByRole('button',{name:'Далее: фото',exact:true}).click();await runner.getByPlaceholder('Опишите результат или отклонение').fill('Учебное отклонение: контрольная точка требует повторного осмотра.');
    const missing=await api(okk.page,'POST',`/checklists/runs/${ev.runId}/rows/${current.rows[i].id}/complete`,{answerBoolean:false,selectedOption:'NO',comment:'Учебное отклонение',operationId:'local03-checklist-no-result'});assert.equal(missing.status,409);ev.referenceNotResult=409;}
   await photo(runner.locator('.checklist-own-photo-card'),50+i);
   if(i===0||i===9)await runner.screenshot({path:path.join(__dirname,`checklist-point-${i+1}.png`)});
   await runner.getByRole('button',{name:i===9?'Проверить и завершить':'Дальше',exact:true}).click();
   if(i<9)await runner.locator('.guided-row-heading').filter({hasText:titles[i+1]}).waitFor();
   ev.completed.push(i+1);save();
  }
  await okk.page.getByRole('dialog',{name:'Проверка чек-листа'}).getByRole('button',{name:'Завершить чек-лист',exact:true}).click();const close=okk.page.getByRole('dialog').filter({hasText:'Причина завершения'});await close.getByLabel('Причина завершения').fill('Учебный десятипунктовый обход LOCAL03 завершён; не санитарный норматив');await close.getByRole('button',{name:'Завершить чек-лист',exact:true}).click();await runner.waitFor({state:'hidden'});
 }
 current=(await api(okk.page,'GET',`/checklists/runs/${ev.runId}`)).body;assert.equal(current.status,'CLOSED');assert.equal(current.rows[0].status,'ISSUE');
 ev.files=[];for(let i=0;i<10;i++){const row=current.rows[i];assert.equal(row.referencePhoto.id,ev.references[i].id);assert.equal(row.attachments.length,1);for(const [kind,id,n]of [['reference',row.referencePhoto.id,30+i],['result',row.attachments[0].id,50+i]]){const d=await download(okk.page,id);assert.equal(d.status,200);assert.equal(sha(d.bytes),sha(png(n)));ev.files.push({point:i+1,kind,id,sha256:sha(d.bytes)});}}
 assert.equal(new Set(ev.files.map(f=>f.sha256)).size,20);
 await okk.page.locator('.checklist-kpi-strip').getByRole('button',{name:/Архив/}).click();await okk.page.locator('.checklist-archive-compact-card').filter({hasText:name}).getByRole('button',{name:'Открыть',exact:true}).click();await runner.getByText('Архив: только просмотр').waitFor();assert.equal(await runner.locator('input[type=file]').count(),0);await runner.screenshot({path:path.join(__dirname,'checklist-closed.png')});
 const sql=await db.checklistRun.findUnique({where:{id:ev.runId},select:{id:true,status:true,rows:{select:{id:true,status:true,referenceAttachmentId:true}}}});assert.equal(sql.status,'CLOSED');assert.equal(sql.rows.length,10);ev.sql=sql;ev.ws=[...new Set(okk.frames.map(f=>f.type))];ev.status='PASS_UI_10_REFERENCE_10_RESULT_CLOSED';save();console.log(JSON.stringify({status:ev.status,templateId:ev.templateId,runId:ev.runId,files:ev.files.length,distinct:20,templateSecondUiMs:ev.templateSecondUiMs}));
}catch(e){ev.error=e.message;save();throw e;}finally{await db.$disconnect();await browser.close();}}
main().catch(e=>{console.error(e.stack);process.exitCode=1;});
