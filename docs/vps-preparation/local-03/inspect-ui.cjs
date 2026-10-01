const {chromium,login,api}=require('../local-02/harness.cjs');
const fs=require('node:fs'); const path=require('node:path');
(async()=>{const browser=await chromium.launch({channel:'msedge',headless:true});try {
 const a=await login(browser,process.argv[2]||'MASTER',1440);
 if(process.argv[3]) await a.page.getByRole('button',{name:process.argv[3],exact:true}).first().click();
 if(process.argv[4]==='run'){await a.page.locator('.checklist-kpi-strip').getByRole('button',{name:/В работе/}).click();await a.page.locator('.checklist-work-card').filter({hasText:'Учебный обход десяти точек LOCAL03'}).getByRole('button',{name:/Продолжить|Открыть/}).click();}
 await a.page.waitForTimeout(800);
 console.log(JSON.stringify({role:a.me.role,permissions:a.me.permissions,text:await a.page.locator('body').innerText(),buttons:await a.page.getByRole('button').allTextContents()},null,2));
 await a.page.screenshot({path:path.join(__dirname,'inspect-ui.png'),fullPage:true});
}finally{await browser.close();}})().catch(e=>{console.error(e.message);process.exitCode=1;});
