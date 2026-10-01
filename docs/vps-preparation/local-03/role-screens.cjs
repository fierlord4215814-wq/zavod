const {assert,chromium,login,api}=require('../local-02/harness.cjs');
const fs=require('node:fs'); const path=require('node:path');
const roles=['MANAGEMENT','MASTER','TECHNOLOG','OKK','STORE','WORKER','TECH_MECHANIC','TECH_ELECTRIC','TECH_HOLOD','TECH_KIPIA','TECH_SANTECHNIK','CONTRACTOR','CONTRACTOR_LEAD','OTHER'];
const labels=['Смена','Люди','Линии','Заявки','Мойка','ОКК','Некондиция','Заказы / Остатки','Чек-листы','Оттайка','Возвраты на производство','Пересменка / Журнал','Чаты','Объявления','Архив','Уведомления'];
const result=[];
async function main(){const browser=await chromium.launch({channel:'msedge',headless:true});try{
 for(const role of roles){const a=await login(browser,role,1440);const row={role,permissions:a.me.permissions,departmentId:a.me.departmentId,ui:[],denials:{},status:'PARTIAL',remaining:'Capability-family operations and contextual denial covered separately'};
 try{
 const responses=[];a.page.on('response',r=>{const u=new URL(r.url());if(u.pathname.startsWith('/api/'))responses.push({path:u.pathname,status:r.status(),method:r.request().method()});});
 row.home=(await a.page.locator('main').innerText().catch(()=>a.page.locator('body').innerText())).slice(0,220);
 row.menu=await a.page.locator('.bottom-nav button').allTextContents();
 row.denials.admin=(await api(a.page,'GET','/admin/overview')).status;assert.equal(row.denials.admin,403);
 row.denials.foreignFactory=await a.page.evaluate(async()=> (await fetch('/api/tasks',{headers:{Authorization:`Bearer ${localStorage.getItem('zavod.authToken')}`,'x-factory-id':'7e9fa429-61a5-48a7-8c23-bdfda0a34bdf'}})).status);assert.equal(row.denials.foreignFactory,403);
 for(const label of labels){const button=a.page.locator('.bottom-nav').getByRole('button',{name:label,exact:true});if(!await button.count())continue;const before=responses.length;await button.click();await a.page.waitForTimeout(350);row.ui.push({label,text:(await a.page.locator('main').innerText().catch(()=>a.page.locator('body').innerText())).slice(0,400),http:responses.slice(before),overflow:await a.page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)});}
 row.wsTypes=[...new Set(a.frames.map(f=>f.type))];
 await a.page.locator('.bottom-nav').getByRole('button',{name:'Настройки',exact:true}).click();
 row.settings=(await a.page.locator('body').innerText()).slice(-1200);
 const logout=a.page.getByRole('button',{name:'Выйти из аккаунта',exact:true});
 if(await logout.isVisible()){await logout.click();await a.page.locator('#login-phone').waitFor();row.logout=true;} else row.logout=false;
 await a.page.screenshot({path:path.join(__dirname,`role-${role.toLowerCase()}.png`)});
 }catch(e){row.error=e.message;row.status='FAIL';}finally{await a.context.close();}
 const b=await login(browser,role,390);row.relogin={role:b.me.role,permissionsEqual:JSON.stringify(b.me.permissions)===JSON.stringify(row.permissions),ws:b.frames.some(f=>f.type==='connected')};await b.context.close();
 result.push(row);fs.writeFileSync(path.join(__dirname,'role-screens.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({role,screens:row.ui.length,denials:row.denials,logout:row.logout,relogin:row.relogin,error:row.error}));
 }
}finally{await browser.close();}}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
