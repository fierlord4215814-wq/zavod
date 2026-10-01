const {assert,chromium,login,api,navigate}=require('../local-02/harness.cjs');
const {ownPrisma,verifyOwnDb}=require('../local-02/own-db.cjs');
const fs=require('node:fs'),path=require('node:path');
const after=process.env.LOCAL03_VERIFY==='1';const out=path.join(__dirname,after?'stock-ui-after.json':'stock-ui.json');const ev=fs.existsSync(out)?JSON.parse(fs.readFileSync(out)):{name:after?'Учебная некондиция LOCAL03 повтор':'Учебная некондиция LOCAL03',attempts:[]};
const save=()=>fs.writeFileSync(out,JSON.stringify(ev,null,2));
async function main(){const browser=await chromium.launch({channel:'msedge',headless:true}),db=ownPrisma();try{
 await verifyOwnDb(db);const a=await login(browser,'ADMIN',390),b=await login(browser,'MANAGEMENT',1440);
 for(const x of [a,b])await navigate(x.page,'Некондиция');
 if(!ev.id){await a.page.getByRole('button',{name:'Создать некондицию',exact:true}).click();const d=a.page.getByRole('dialog').filter({has:a.page.getByRole('heading',{name:'Создать некондицию',exact:true})});await d.getByLabel('Наименование',{exact:true}).fill(ev.name);await d.getByLabel('Количество',{exact:true}).fill('12');await d.getByLabel('Единица',{exact:true}).selectOption('гофры');
  const [r]=await Promise.all([a.page.waitForResponse(r=>r.url().endsWith('/api/stock')&&r.request().method()==='POST'),d.getByRole('button',{name:'Создать',exact:true}).click()]);assert.equal(r.status(),201);ev.id=(await r.json()).id;save();
 }
 const witness={at:new Date().toISOString(),kind:'create',http:(await api(b.page,'GET','/stock')).status};
 try{await b.page.locator('.compact-record-card').filter({hasText:ev.name}).waitFor({timeout:9500});witness.secondUi=true;}catch{witness.secondUi=false;}
 witness.sql=await db.stockDefect.findUnique({where:{id:ev.id},select:{id:true,name:true,quantity:true,unit:true,status:true}});await b.page.screenshot({path:path.join(__dirname,`stock-second-before-${ev.attempts.length}.png`)});ev.attempts.push(witness);save();
 if(!witness.secondUi){console.log(JSON.stringify({status:'FAIL_SECOND_UI_CREATE',...witness}));return;}
 const card=a.page.locator('.compact-record-card').filter({hasText:ev.name});await card.getByRole('button',{name:'Подробнее',exact:true}).click();await a.page.getByRole('button',{name:'Редактировать',exact:true}).click();const d=a.page.getByRole('dialog').filter({has:a.page.getByRole('heading',{name:'Редактировать некондицию',exact:true})});await d.getByLabel('Количество',{exact:true}).fill('13');await d.getByRole('button',{name:'Сохранить',exact:true}).click();await d.waitFor({state:'hidden'});
 await b.page.locator('.compact-record-card').filter({hasText:ev.name}).filter({hasText:'13 гофры'}).waitFor({timeout:10000});ev.editSecondUi=true;save();
 await a.page.reload({waitUntil:'networkidle'});await navigate(a.page,'Некондиция');await a.page.locator('.compact-record-card').filter({hasText:ev.name}).filter({hasText:'13 гофры'}).waitFor();ev.persisted=true;save();console.log(JSON.stringify({status:'PASS_CREATE_EDIT_SECOND_UI',id:ev.id}));
}finally{await db.$disconnect();await browser.close();}}
main().catch(e=>{ev.error=e.message;save();console.error(e.stack);process.exitCode=1;});
