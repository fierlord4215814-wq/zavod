// Isolated backend preload: never T1, never production activation, no external push.
const assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs');
const u=new URL(process.env.DATABASE_URL);assert.equal(u.hostname,'127.0.0.1');assert.equal(u.port,'15437');assert.equal(u.pathname,'/zavod_factory01_notify02');assert.equal(process.env.APP_VERSION,'FACTORY01-20260926-NOTIFY02');assert.equal(process.env.ALLOW_TEST_AUTH_HEADERS,'false');
const mode=process.env.NOTIFY02_FAULT;assert(['before-publication','ws','push'].includes(mode));require('reflect-metadata');const root=path.resolve(__dirname,'../../..');
const{NotificationsService}=require(path.join(root,'backend/dist/modules/notifications/notifications.service')),{WsService}=require(path.join(root,'backend/dist/ws/ws.service')),{PushService}=require(path.join(root,'backend/dist/push/push.service'));
const types=new Set(['ORDER_REQUEST_CREATED','ORDER_STOCK_BELOW_THRESHOLD','ORDER_REQUEST_CLOSED','TASK_DONE','TASK_REDIRECTED','TASK_LONG_ESCALATED']),first=new Set(),invalidate=new Set();let resolving=false;
const record=(phase,n={})=>fs.appendFileSync(path.join(__dirname,`transport-${mode}.ndjson`),JSON.stringify({atUtc:new Date().toISOString(),phase,type:n.type,id:n.id,entityId:n.entityId})+'\n');
const publish=NotificationsService.prototype.publishNotification;
NotificationsService.prototype.publishNotification=async function(n){if(types.has(n.type)){const row=await this.prisma.db.notification.findUniqueOrThrow({where:{id:n.id}});assert.equal(row.entityId,n.entityId);record('COMMITTED_ROW_PUBLICATION_ATTEMPT',n);invalidate.add(n.entityId);const key=n.type+':'+n.entityId;if(mode==='before-publication'&&!first.has(key)){first.add(key);record('FIRST_RECIPIENT_THROW',n);throw Error('OWN_FIRST_RECIPIENT_THROW');}}return publish.call(this,n);};
const resolution=NotificationsService.prototype.publishCommittedResolution;
NotificationsService.prototype.publishCommittedResolution=async function(r){resolving=true;try{return await resolution.call(this,r);}finally{resolving=false;}};
const send=WsService.prototype.sendToUsers,broadcast=WsService.prototype.broadcast;
WsService.prototype.sendToUsers=function(ids,type,n){if(mode==='ws'&&type==='notification_created'&&types.has(n?.type)){record('WS_THROW',n);throw Error('OWN_NOTIFICATION_WS_THROW');}if(mode==='ws'&&resolving){record('RESOLUTION_COUNT_THROW');throw Error('OWN_RESOLUTION_COUNT_THROW');}return send.call(this,ids,type,n);};
WsService.prototype.broadcast=function(type,n){if(mode==='ws'&&['orders_updated','task_updated'].includes(type)&&invalidate.delete(n?.id)){record('ENTITY_INVALIDATION_THROW',{id:n.id,type});throw Error('OWN_ENTITY_INVALIDATION_THROW');}return broadcast.call(this,type,n);};
PushService.prototype.sendNotificationToUsers=async function(ids,n){if(mode==='push'&&types.has(n.type)){record('PUSH_THROW',n);throw Error('OWN_PUSH_THROW');}return{disabled:true};};
