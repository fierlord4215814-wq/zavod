require('./master-offline-guard.cjs'); require('reflect-metadata');
const {memory,strict,copy} = require('./master-r2-memory.cjs');
const {ChatsService} = require('../dist/modules/chats/chats.service');
function chatFixture(action) {
  const m = memory(), user = {userId:'membership-actor',selectedFactoryId:'membership-factory',departmentId:'membership-dept',role:'MASTER',isAdmin:false,isGuest:false,permissions:['chats.access','chats.read','chats.write']};
  const users = [user.userId,'membership-target','membership-third'].map(id=>({id,displayName:id,blockedAt:null,deletedAt:null}));
  const members = users.map((u,index)=>({id:`member-${index}`,chatId:'membership-chat',userId:u.id,user:u,department:null,roleCode:null,departmentId:null,membershipRole:index===0?'OWNER':'MEMBER',canRead:true,canWrite:true,canManage:index===0,leftAt:null,removedAt:null,communicationBlockedAt:null}));
  const chat = {id:'membership-chat',factoryId:user.selectedFactoryId,title:'Упаковка',departmentId:null,department:null,type:action==='block'?'DIRECT':'CUSTOM',isActive:true,isHidden:false,archivedAt:null};
  m.data.chat = m.model('chat',[chat],{includes:['department','members'],enrich:r=>({...r,members:copy(members)})});
  m.data.chatMember = m.model('chatMember',members,{includes:['user','department']});
  const accesses = users.map(u=>({userId:u.id,factoryId:user.selectedFactoryId,role:'MASTER',isActive:true,isGuest:false,user:u}));
  // LOCAL-02 eligibility is a real capability; keep the existing membership assertions.
  m.data.rolePermission=m.model('rolePermission',user.permissions.map(permissionCode=>({role:'MASTER',permissionCode,isActive:true})));
  m.data.userPermissionOverride=m.model('userPermissionOverride',[]);
  m.data.userFactoryAccess = m.model('userFactoryAccess',accesses);
  const messages=[]; m.data.chatMessage = m.model('chatMessage',messages);
  const service = new ChatsService({db:m.db},m.audit,m.attachments,m.ws), operationId=`membership-${action}`;
  const target = ['block','leave'].includes(action)?members[0]:members[1];
  const call = () => action==='add'?service.addMember(user,chat.id,{userId:target.userId,operationId}):action==='remove'?service.removeMember(user,chat.id,target.userId,{operationId}):action==='role'?service.updateMemberRole(user,chat.id,target.userId,{role:'ADMIN',operationId}):action==='transfer'?service.transferOwnership(user,chat.id,{userId:target.userId,operationId}):action==='leave'?service.leave(user,chat.id,{operationId}):service.setDirectCommunicationBlock(user,chat.id,{blocked:true,operationId});
  return {...m,user,users,members,chat,messages,service,operationId,target,call};
}
function chatChainFixture(){
 const assert=require('node:assert/strict'); const {installAuthority}=require('./master-r2-authority-fixture.cjs');
 const {ChatsController}=require('../dist/modules/chats/chats.controller');
 const {AttachmentsService}=require('../dist/modules/attachments/attachments.service'),{AttachmentsController}=require('../dist/modules/attachments/attachments.controller');
 const {PermissionGuard}=require('../dist/common/permission.guard'),{Reflector}=require('@nestjs/core');
 const f=chatFixture('transfer'),files=[],reads=[],storageReads=[];
 const accesses=f.users.map(u=>({id:'access-'+u.id,userId:u.id,factoryId:f.user.selectedFactoryId,isActive:true,isGuest:false,deactivatedAt:null,role:'MASTER',departmentId:f.user.departmentId,companyId:null,factory:{isActive:true,deletedAt:null},user:u,department:null}));
 f.data.userFactoryAccess=f.model('userFactoryAccess',accesses,{includes:['user','department']});
 const {resolve}=installAuthority(f,f.users,accesses,{MASTER:f.user.permissions});
 f.chat.createdAt=new Date();f.data.chat=f.model('chat',[f.chat],{includes:['department','members','messages','reads'],enrich:r=>({...r,members:copy(f.members),messages:f.messages.filter(x=>x.chatId===r.id&&!x.deletedAt).slice(-1),reads:reads.filter(x=>x.chatId===r.id)})});
 f.data.chatSettings=f.model('chatSettings',[{id:'settings',factoryId:f.user.selectedFactoryId,chatEnabled:true,deleteWindowMinutes:15,editWindowMinutes:15}]);
 f.data.chatRead=f.model('chatRead',reads,{compounds:['chatId_userId']});f.data.chatMessageReaction=f.model('chatMessageReaction',[],{includes:['user']});f.data.chatPoll=f.model('chatPoll',[],{includes:['options','votes']});
 f.data.chatMessage=f.model('chatMessage',f.messages,{includes:['chat'],compounds:['authorId_operationId'],unique:[['authorId','operationId']],enrich:r=>({...r,chat:{...copy(f.chat),members:copy(f.members)}})});
 f.data.attachment=f.model('attachment',files);
 f.data.department=f.model('department',[]);
 const directory=new (require('../dist/modules/directory/directory.service').DirectoryService)({db:f.db});
 const directoryController=new (require('../dist/modules/directory/directory.controller').DirectoryController)(directory);
 const storage=strict({readStorageFile:async key=>{assert.equal(key,'memory-only-buffer');storageReads.push(key);return Buffer.from('Изолированное содержимое');}});
 const attachments=new AttachmentsService({db:f.db},storage,f.audit),service=new ChatsService({db:f.db},f.audit,attachments,f.ws),controller=new ChatsController(service),fileController=new AttachmentsController(attachments),guard=new PermissionGuard(new Reflector(),f.audit);
 const call=async(c,method,user,args)=>{await guard.canActivate({getClass:()=>c.constructor,getHandler:()=>c.constructor.prototype[method],switchToHttp:()=>({getRequest:()=>({user,method:'ISOLATED',url:method})})});return c[method](...args);};
 const context=id=>resolve(id,f.user.selectedFactoryId);
 const addFile=message=>{const row={id:'message-file',factoryId:f.user.selectedFactoryId,entityType:'CHAT_MESSAGE',entityId:message.id,uploadedById:message.authorId,originalName:'Осмотр.txt',mimeType:'text/plain',kind:'FILE',sizeBytes:44,storagePath:'memory-only-buffer',deletedAt:null};files.push(row);return row;};
 return {...f,context,files,reads,storageReads,attachments,service,controller,fileController,directoryController,call,addFile,account:f.users[0],access:accesses[0],accesses,authorityFixture:{resolve}};
}
module.exports={chatFixture,chatChainFixture};
