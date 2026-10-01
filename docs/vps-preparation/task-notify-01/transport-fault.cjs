// Test-process preload only. Cannot run against T1 or any non-owned database.
const assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs');
const u=new URL(process.env.DATABASE_URL);
assert.equal(u.hostname,'127.0.0.1');assert.equal(u.port,'15437');assert.equal(u.pathname,'/zavod_factory01_task_notify');
assert.equal(process.env.APP_VERSION,'FACTORY01-20260926-TASKNOTIFY');assert.equal(process.env.ALLOW_TEST_AUTH_HEADERS,'false');
const mode=process.env.TASK_NOTIFY_FAULT;assert(['before-publication','ws','push'].includes(mode));
const root=path.resolve(__dirname,'../../..');require('reflect-metadata');
const{NotificationsService}=require(path.join(root,'backend/dist/modules/notifications/notifications.service')),{WsService}=require(path.join(root,'backend/dist/ws/ws.service')),{PushService}=require(path.join(root,'backend/dist/push/push.service'));
const record=phase=>fs.appendFileSync(path.join(__dirname,`transport-${mode}.ndjson`),JSON.stringify({atUtc:new Date().toISOString(),phase,mode})+'\n');
if(mode==='before-publication'){
 const orig=NotificationsService.prototype.publishNotification;
 NotificationsService.prototype.publishNotification=async function(n){if(n.type==='TASK_CREATED'){const row=await this.prisma.db.notification.findUniqueOrThrow({where:{id:n.id}});assert.equal(row.entityId,n.entityId);record('COMMITTED_ROW_READ_BEFORE_PUBLICATION_THROW');throw Error('OWN_POSTCOMMIT_PUBLICATION_FAULT');}return orig.call(this,n);};
}
if(mode==='ws'){
 const send=WsService.prototype.sendToUsers,broadcast=WsService.prototype.broadcast;
 WsService.prototype.sendToUsers=function(ids,type,payload){if(type==='notification_created'&&payload?.type==='TASK_CREATED'){record('WS_TRANSPORT_THROW');throw Error('OWN_WS_FAULT');}return send.call(this,ids,type,payload);};
 WsService.prototype.broadcast=function(type,payload){if(type==='task_updated'&&payload?.status==='NEW'){record('TASK_INVALIDATION_THROW');throw Error('OWN_WS_INVALIDATION_FAULT');}return broadcast.call(this,type,payload);};
}
// No external Push may be sent by this fault process.
PushService.prototype.sendNotificationToUsers=async function(ids,n){if(mode==='push'&&n.type==='TASK_CREATED'){record('PUSH_TRANSPORT_THROW');throw Error('OWN_PUSH_FAULT');}return{disabled:true};};
