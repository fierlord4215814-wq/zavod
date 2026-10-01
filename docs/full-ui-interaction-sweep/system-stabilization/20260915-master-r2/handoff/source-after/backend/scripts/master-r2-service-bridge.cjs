// IPC-only actual controller/guard/service bridge. No listener, Nest bootstrap, DB or real files.
require('./master-offline-guard.cjs');require('reflect-metadata');
const assert=require('node:assert/strict');
const {fixture}=require('./master-r2-publication-fixture.cjs'),{handoverFixture}=require('./master-r2-handover-fixture.cjs');
const {installAuthority,withIdentity}=require('./master-r2-authority-fixture.cjs');
const {PermissionGuard}=require('../dist/common/permission.guard'),{Reflector}=require('@nestjs/core');
const mode=process.argv[2];assert.ok(['publication','handover'].includes(mode));
const f=mode==='publication'?fixture(true,'current','IMPORTANT',{userId:'series-user',selectedFactoryId:'series-factory',departmentId:'series-department'}):handoverFixture();
f.access.factory={isActive:true,deletedAt:null};f.access.departmentId=f.user.departmentId;f.access.companyId=null;f.account.passwordResetRequired=false;
const grants=[...f.user.permissions],{resolve}=installAuthority(f,[f.account],[f.access],{MASTER:grants}),guard=new PermissionGuard(new Reflector(),f.audit),ledger=[];
process.env.NODE_ENV='test';process.env.ZAVOD_INTERNAL_TEST_NOW='2026-09-15T16:30:00Z';
async function invoke(method,args,user){const controller=f.controller;await guard.canActivate({getClass:()=>controller.constructor,getHandler:()=>controller.constructor.prototype[method],switchToHttp:()=>({getRequest:()=>({user,method:'ISOLATED',url:method})})});ledger.push({receiver:`${controller.constructor.name}.${method}`,userId:user.userId,factoryId:user.selectedFactoryId,args});return controller[method](...args);}
async function request(message){
  if(message.command==='inspect')return {ledger,logs:f.logs,reads:f.reads,notices:f.notices,audits:f.audits,writes:f.writes,accessActive:f.access.isActive};
  if(message.command==='rejectRead'){f.rejectRead();return {configured:true};}if(message.command==='allowRead'){f.allowRead();return{configured:true};}
  if(message.command==='revoke'){f.access.isActive=false;return{configured:true};}if(message.command==='restore'){f.access.isActive=true;return{configured:true};}
  if(message.command==='archiveSnapshotFixture'){assert.equal(mode,'handover');const row=f.logs.find(x=>x.id===message.entityId);assert.ok(row);row.status='ARCHIVED';return {configuredFixtureId:row.id};}
  const user=await resolve(f.user.userId,message.factory||f.user.selectedFactoryId),p=message.path,body=message.body??{},q=message.query??{},verb=message.method||'GET';
  if(p==='/auth/me')return {...user,displayName:'Мастер смены',availableFactories:[{id:f.user.selectedFactoryId,name:'Изолированный завод',role:'MASTER',isGuest:false}]};
  if(mode==='publication'){
    if(p==='/announcements'&&verb==='GET')return invoke('list',[user,q],user);
    if(p==='/announcements/current')return invoke('current',[user],user);if(p==='/announcements/unread')return invoke('unread',[user],user);if(p==='/announcements/archive')return invoke('archiveList',[user,q],user);
    if(p==='/notifications')return f.notification.list(user,q);if(p==='/notifications/unread-count')return f.notification.unreadCount(user);
    const match=p.match(/^\/announcements\/([^/]+)(?:\/(ack|read|ack-report))?$/);if(match){const method=match[2]==='ack'?'acknowledge':match[2]==='read'?'markRead':match[2]==='ack-report'?'ackReport':'detail';assert.equal(verb,['ack','read'].includes(match[2])?'POST':'GET');return invoke(method,[user,match[1]],user);}
  }else{
    if(p==='/shift-log/handover/availability')return invoke('handoverAvailability',[user,q.departmentId],user);if(p==='/shift-log/handover/summary')return invoke('handoverSummary',[user,q.departmentId],user);if(p==='/shift-log/handover/previous')return invoke('previousHandover',[user,q.departmentId],user);if(p==='/shift-log/handover'&&verb==='POST')return invoke('createHandover',[body,user],user);
    if(p==='/shift-log'&&verb==='POST')return invoke('createLog',[body,user],user);if(p==='/shift-log')return invoke('listLogs',[user,q],user);if(p==='/shift-log/archive')return invoke('archive',[user,q],user);
    const archive=p.match(/^\/shift-log\/archive\/([^/]+)$/);if(archive)return invoke('getArchiveLog',[user,archive[1],q],user);
    const match=p.match(/^\/shift-log\/([^/]+)(?:\/(read|comment))?$/);if(match){if(match[2]==='read'){assert.equal(verb,'POST');return invoke('markRead',[user,match[1]],user);}if(match[2]==='comment'){assert.equal(verb,'POST');return invoke('addComment',[match[1],body,user],user);}return invoke('getLog',[user,match[1]],user);}
  }
  throw Error(`UNMOCKED_IPC_ROUTE ${verb} ${p}`);
}
let tail=Promise.resolve();
process.on('message',message=>{tail=tail.then(()=>withIdentity(()=>request(message))).then(value=>process.send({id:message.id,ok:true,value}),error=>process.send({id:message.id,ok:false,status:error.getStatus?.()??500,message:error.getResponse?.()?.message??(error.getStatus?.()===503?'Изолированное хранилище временно недоступно.':error.message)}));});
process.on('disconnect',()=>process.exit(0));
