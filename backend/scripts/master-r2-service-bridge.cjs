// IPC-only actual controller/guard/service bridge. No listener, Nest bootstrap, DB or real files.
require('./master-offline-guard.cjs');require('reflect-metadata');
const assert=require('node:assert/strict');
const {fixture}=require('./master-r2-publication-fixture.cjs'),{handoverFixture}=require('./master-r2-handover-fixture.cjs');
const {installAuthority,withIdentity}=require('./master-r2-authority-fixture.cjs');
const {PermissionGuard}=require('../dist/common/permission.guard'),{Reflector}=require('@nestjs/core');
const mode=process.argv[2];assert.ok(['publication','handover','task','chat'].includes(mode));
const f=mode==='chat'?require('./master-r2-chat-fixture.cjs').chatChainFixture():mode==='task'?require('./master-r2-task-fixture.cjs').taskBridgeFixture():mode==='publication'?fixture(true,'current','IMPORTANT',{userId:'series-user',selectedFactoryId:'series-factory',departmentId:'series-department'},true):handoverFixture(true);
f.access.factory={isActive:true,deletedAt:null};f.access.departmentId=f.user.departmentId;f.access.companyId=null;f.account.passwordResetRequired=false;
const grants=[...f.user.permissions],{resolve}=f.authorityFixture??installAuthority(f,[f.account],[f.access],{MASTER:grants}),guard=new PermissionGuard(new Reflector(),f.audit),ledger=[];
process.env.NODE_ENV='test';process.env.ZAVOD_INTERNAL_TEST_NOW='2026-09-15T16:30:00Z';
async function invoke(method,args,user,controller=f.controller){await guard.canActivate({getClass:()=>controller.constructor,getHandler:()=>controller.constructor.prototype[method],switchToHttp:()=>({getRequest:()=>({user,method:'ISOLATED',url:method})})});ledger.push({receiver:`${controller.constructor.name}.${method}`,userId:user.userId,factoryId:user.selectedFactoryId,args:args.filter(x=>!x?.setHeader)});return controller[method](...args);}
async function request(message){
  if(message.command==='inspect')return {ledger,logs:f.logs,reads:f.reads,notices:f.notices,audits:f.audits,writes:f.writes,tasks:f.tasks,messages:f.messages,storageReadCount:f.storageReads?.length,operations:f.operations,events:f.events,accessActive:f.access.isActive};
  if(message.command==='chatFileFixture'){assert.equal(mode,'chat');const row=f.messages.find(x=>x.id===message.entityId);assert.ok(row);return {id:f.addFile(row).id,scope:'metadata precondition after actual message writer, not upload proof'};}
  if(message.command==='rejectNotice'){assert.equal(mode,'publication');f.rejectNotice();return{configured:true};}
  if(message.command==='publicationState'){assert.equal(mode,'publication');assert.ok(['current','expired','future'].includes(message.state));f.row.visibleFrom=new Date(Date.now()+(message.state==='future'?86400000:-86400000));f.row.visibleUntil=new Date(Date.now()+(message.state==='expired'?-1000:86400000));return{configured:true};}
  if(message.command==='rejectRead'){f.rejectRead();return {configured:true};}if(message.command==='allowRead'){f.allowRead();return{configured:true};}
  if(message.command==='revoke'){f.access.isActive=false;return{configured:true};}if(message.command==='restore'){f.access.isActive=true;return{configured:true};}
  if(message.command==='archiveSnapshotFixture'){assert.equal(mode,'handover');const row=f.logs.find(x=>x.id===message.entityId);assert.ok(row);row.status='ARCHIVED';return {configuredFixtureId:row.id};}
  const user=await resolve(message.actor||f.user.userId,message.factory||f.user.selectedFactoryId),p=message.path,body=message.body??{},q=message.query??{},verb=message.method||'GET';
  if(p==='/auth/me')return {...user,displayName:'Мастер смены',availableFactories:[{id:f.user.selectedFactoryId,name:'Изолированный завод',role:'MASTER',isGuest:false}]};
  if(mode==='chat'){
    if(p==='/directory/departments'){assert.equal(verb,'GET');return invoke('departments',[user,q.q,q.factoryId],user,f.directoryController);}
    if(p==='/directory/users'){assert.equal(verb,'GET');return invoke('users',[user,q.q,q.query,q.role,q.departmentId,q.factoryId,q.page,q.limit],user,f.directoryController);}
    if(p==='/chats')return invoke('list',[user,q],user);
    const file=p.match(/^\/attachments\/([^/]+)(?:\/(file))?$/);if(file){if(!file[2])return invoke('metadata',[file[1],user],user,f.fileController);let body;const headers={};const response={setHeader:(k,v)=>headers[k]=v,send:b=>body=b.toString('base64')};await invoke('file',[file[1],user,response],user,f.fileController);return {body,headers,encoding:'base64',scope:'memory storage bytes; not HTTP Range'};}
    const remove=p.match(/^\/chats\/([^/]+)\/members\/([^/]+)\/remove$/);if(remove){assert.equal(verb,'POST');return invoke('removeMember',[user,remove[1],remove[2],body],user);}
    const match=p.match(/^\/chats\/([^/]+)(?:\/(messages|read|members|media|leave|transfer-ownership))?$/);if(match){const action=match[2],method={messages:'createMessage',read:'markRead',members:'members',media:'media',leave:'leave','transfer-ownership':'transferOwnership'}[action]||'detail';assert.equal(verb,action&&['messages','read','leave','transfer-ownership'].includes(action)?'POST':'GET');return invoke(method,action==='read'||action==='members'||action==='media'?[user,match[1]]:[user,match[1],action?body:q],user);}
  }else if(mode==='task'){
    if(p==='/tasks'&&verb==='POST')return invoke('createTask',[body,user],user);
    if(p==='/tasks'&&verb==='GET')return invoke('listTasks',[user,q.status,q.type,q.my,q.departmentId,q.assignedToMe,q.lineId,q.includeDone,q.includeFixtures,q.overdue,q.search],user);
    if(p==='/tasks/board')return invoke('board',[user,q.includeFixtures],user);
    if(p==='/tasks/assignee-candidates')return invoke('assigneeCandidates',[user,q.query,q.departmentId],user);
    if(p==='/tasks/recipient-departments')return invoke('recipientDepartments',[user],user);
    if(p==='/tasks/archive/summary')return invoke('archiveSummary',[user,q.dateFrom,q.dateTo,q.lineId,q.departmentId,q.assigneeId,q.type,q.status,q.shiftType,q.includeFixtures],user);
    if(p==='/notifications')return f.notification.list(user,q);if(p==='/notifications/unread-count')return f.notification.unreadCount(user);
    if(p==='/ops/audit')return f.ops.audit(user,q);
    const match=p.match(/^\/tasks\/([^/]+)(?:\/(take|complete|comment|redirect|read|reads))?$/);if(match){const action=match[2],method={take:'takeTask',complete:'completeTask',comment:'addComment',redirect:'redirectTask',read:'markRead',reads:'reads'}[action]||'detail';assert.equal(verb,action&&action!=='reads'?'POST':'GET');return invoke(method,['detail','markRead','reads'].includes(method)?[match[1],user]:[match[1],body,user],user);}
  }else if(mode==='publication'){
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
