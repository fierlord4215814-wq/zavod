const l=require('./cases.cjs');
const serial=x=>JSON.parse(JSON.stringify(x));
async function listed(c,actors,p){const all=[...Object.values(actors)];const expected=await l.notices(p,c.id,c.event),seen=[];
 for(const actor of all){const wanted=expected.filter(n=>n.userId===actor.me.userId||n.userId===null);if(!wanted.length)continue;const r=await l.api(actor.page,'GET','/notifications');l.assert.equal(r.status,200);const visible=r.body.filter(n=>n.entityId===c.id&&n.type===c.event),allowed=actor.me.role==='ADMIN'||actor.me.permissions.includes(c.sourceType==='TASK'?'tasks.read':'orders.read');
 if(allowed){l.assert.equal(visible.length,1,`${c.key}/${actor.key} canonical per-event visible dedupe`);l.assert(wanted.some(n=>n.id===visible[0].id));}else l.assert.equal(visible.length,0,'Current source capability required');seen.push({userId:actor.me.userId,requiredRows:wanted.map(n=>n.id),visibleIds:visible.map(n=>n.id),currentCapability:allowed});}
 l.assert(seen.some(x=>x.visibleIds.length));return seen;
}
(async()=>{const p=l.prisma(),q=l.prisma(),b=await l.chromium.launch({channel:'msedge',headless:true}),ev={status:'IN_PROGRESS',cases:[]};let hold,pending=[];const stamp=Date.now();
try{await l.identity(q);const actors=await l.actors(b);actors.g=await l.login(b,'MANAGEMENT',390);
 for(const key of l.keys){const c=await l.makeCase(actors,key,`retry-${stamp}-${key}`);hold=await l.barrier(p,'LOCK TABLE "AuditLog" IN SHARE MODE');const first=c.call();pending=[first];const w=await l.waiter(q,hold.pid,r=>r.query.startsWith('INSERT')&&r.query.includes('AuditLog'));const second=c.call();pending.push(second);const w2=await l.waiter(q,w.pid,r=>r.query.includes('pg_advisory_xact_lock'));const waits={business:w.pid,retry:w2.pid,holder:hold.pid};hold.release();await hold.finished;hold=null;const results=await Promise.all(pending);pending=[];for(const r of results)l.assert.equal(r.status,201);await c.discover(q);const saved=await c.state(q);l.assert.equal(saved.notifications.length,c.expectedRows);l.assert.equal(saved.audit.length,1);if(c.sourceType==='TASK')l.assert.equal(saved.history.length,1);if(c.operationId)l.assert.equal(saved.processed.length,1);
 if(key==='task-escalated')l.assert.deepEqual(results.map(r=>r.body.escalated).sort(),[0,1]);else l.assert(results.every(r=>r.body.id===c.id));
 const lists=await listed(c,actors,q);const retry=await c.call();l.assert.equal(retry.status,201);l.assert.deepEqual(l.stable(await c.state(q)),l.stable(saved));
 // Current authority and later business state are re-read, but the historical event is not recreated.
 if(key==='task-redirect'||key==='task-escalated'){const r=await l.api(actors.m.page,'POST',`/tasks/${c.id}/redirect`,{operationId:`notify02-later-${stamp}-${key}`,newDepartmentRecipientIds:[actors.t.me.departmentId],newAssigneeUserIds:[actors.t.me.userId],comment:'Последующая законная передача'});l.assert.equal(r.status,201);}
 await c.close();const afterLater=await c.state(q),late=await c.call();l.assert.equal(late.status,201);l.assert.deepEqual(l.stable(await c.state(q)),l.stable(afterLater));
 ev.cases.push({key,event:c.event,kind:'G_I',waits,http:results.map(r=>r.status),scannerResults:key==='task-escalated'?results.map(r=>r.body.escalated):undefined,saved,lists,lateHttp:late.status,afterLater,closed:true});l.receipt('retry',ev);console.log(key+' concurrent + later-state PASS');
 }
 const restart=[];
 for(const key of l.keys){const c=await l.makeCase(actors,key,`lost-${stamp}-${key}`);let intercepted;const pattern='**/api'+c.path;
 await c.actor.page.route(pattern,async route=>{if(route.request().method()!=='POST')return route.continue();const r=await route.fetch();l.assert.equal(r.status(),201);intercepted={status:r.status(),id:(await r.json()).id??null};await route.abort('connectionreset');});
 const lost=await c.call().catch(()=>({networkError:true}));await c.actor.page.unroute(pattern);l.assert(lost.networkError);await c.discover(q);const saved=await c.state(q);l.assert.equal(saved.notifications.length,c.expectedRows);const lists=await listed(c,actors,q);const replay=await c.call();l.assert.equal(replay.status,201);l.assert.deepEqual(l.stable(await c.state(q)),l.stable(saved));
 const before=await c.state(q);restart.push({key,event:c.event,id:c.id,operationId:c.operationId,actor:c.actor.key,body:c.body,path:c.path,expectedRows:c.expectedRows,sourceType:c.sourceType,before:serial(before)});
 ev.cases.push({key,event:c.event,kind:'F',intercepted,clientNetworkError:true,saved,listBeforeAnyRetry:lists,replay:201,restartPending:true});l.receipt('retry',ev);l.receipt('restart-pending',{status:'PENDING_NATIVE_RESTART',cases:restart});console.log(key+' lost body + durable list PASS');
 }
 // The alternative DONE path starts with a real take, not only NEW -> DONE.
 const c=await l.makeCase(actors,'task-done',`take-done-${stamp}`);l.assert.equal((await l.api(actors.t.page,'POST',`/tasks/${c.id}/take`,{operationId:`notify02-take-done-${stamp}`})).status,201);l.assert.equal((await c.call()).status,201);const s=await c.state(q);l.assert.equal(s.business.status,'DONE');l.assert.equal(s.notifications.length,1);ev.takeThenDone=s;
 ev.status='PASS_G_I_SEVEN_CASES_F_SEVEN_CASES_TAKE_DONE';l.receipt('retry',ev);
}catch(e){ev.error=l.safeError(e);l.receipt('retry',ev);throw e;}finally{hold?.release();await hold?.finished;await Promise.allSettled(pending);await p.$disconnect();await q.$disconnect();await b.close();}})().catch(e=>{console.error(l.safeError(e));process.exitCode=1;});
module.exports={listed};
