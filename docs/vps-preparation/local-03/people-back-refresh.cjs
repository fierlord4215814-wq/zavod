const {assert,chromium,login,api,navigate}=require('../local-02/harness.cjs');
const {ownPrisma,verifyOwnDb}=require('../local-02/own-db.cjs');
const fs=require('node:fs'),path=require('node:path');
async function main(){
 const db=ownPrisma();await verifyOwnDb(db);const browser=await chromium.launch({channel:'msedge',headless:true});
 const ev={kind:'real shift HTTP -> operational event -> browser Back before People profile debounce'};let w,started=false;
 try{
  const a=await login(browser,'MASTER');w=await login(browser,'WORKER');await navigate(a.page,'Люди');
  await a.page.getByRole('button',{name:'Все',exact:true}).click();
  await a.page.getByRole('button',{name:'Поиск и фильтры',exact:true}).click();
  const d=a.page.getByRole('dialog',{name:'Поиск и фильтры'});await d.getByRole('textbox').fill('1002');await d.getByRole('button',{name:'Показать',exact:true}).click();
  await a.page.locator('.people-compact-row').filter({hasText:'10-02'}).click();await a.page.locator('.profile-card').waitFor();
  ev.before=(await api(w.page,'GET','/shift/me')).body.shiftSession;assert.equal(ev.before,null);
  await a.page.evaluate((id)=>{
   window.__local03Back={events:[],requests:[]};const t=window.__local03Back;
   const base=window.fetch;window.fetch=function(input,init){const url=typeof input==='string'?input:input.url;t.requests.push({url:url?.replace(/\?.*$/,''),at:performance.now()});return base.apply(this,arguments);};
   const obs=new MutationObserver(()=>{if(!document.querySelector('.profile-card')&&!t.closedAt)t.closedAt=performance.now();});obs.observe(document.body,{childList:true,subtree:true});
   window.addEventListener('popstate',()=>t.events.push({type:'popstate',at:performance.now()}));
   const handler=(e)=>{if(e.detail?.reason!=='shift')return;window.removeEventListener('zavod:operational-data-invalidated',handler);t.eventAt=performance.now();t.detail=e.detail;history.back();};
   window.addEventListener('zavod:operational-data-invalidated',handler);
   t.profileId=id;
  },w.me.userId);
  assert.equal((await api(w.page,'POST','/shift/start',{})).status,201);started=true;
  await a.page.waitForFunction(()=>Boolean(window.__local03Back?.closedAt));await a.page.waitForTimeout(650);
  ev.trace=await a.page.evaluate(()=>window.__local03Back);ev.closeDeltaMs=ev.trace.closedAt-ev.trace.eventAt;assert.ok(ev.closeDeltaMs>=0&&ev.closeDeltaMs<140);
  assert.equal(await a.page.locator('.profile-card').count(),0);ev.lateProfileRequests=ev.trace.requests.filter(r=>r.at>=ev.trace.closedAt&&r.url.endsWith(`/people/${w.me.userId}`));assert.equal(ev.lateProfileRequests.length,0);
  ev.sessionId=(await api(w.page,'GET','/shift/me')).body.shiftSession.id;
  assert.equal((await api(w.page,'POST','/shift/end',{})).status,201);started=false;
  ev.sql=await db.shiftSession.findUnique({where:{id:ev.sessionId},select:{status:true,endedAt:true}});assert.equal(ev.sql.status,'ENDED');ev.status='PASS_PENDING_PROFILE_REFRESH_BACK';
  await a.page.screenshot({path:path.join(__dirname,'people-back-refresh.png')});
 }catch(e){ev.error=e.message;throw e;}finally{if(started)ev.finallyEnd=(await api(w.page,'POST','/shift/end',{})).status;fs.writeFileSync(path.join(__dirname,'people-back-refresh.json'),JSON.stringify(ev,null,2));await db.$disconnect();await browser.close();console.log(JSON.stringify(ev));}
}
main().catch(e=>{console.error(e.stack);process.exitCode=1;});
