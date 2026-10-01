require('./master-offline-guard.cjs');require('reflect-metadata');
const {test}=require('node:test'),assert=require('node:assert/strict');
const {chatFixture}=require('./master-r2-chat-fixture.cjs');
const {strict,copy,denied}=require('./master-r2-memory.cjs');
const {installAuthority,withIdentity}=require('./master-r2-authority-fixture.cjs');
const {ChatsService}=require('../dist/modules/chats/chats.service'),{ChatsController}=require('../dist/modules/chats/chats.controller');
const {AttachmentsService}=require('../dist/modules/attachments/attachments.service'),{AttachmentsController}=require('../dist/modules/attachments/attachments.controller');
const {PermissionGuard}=require('../dist/common/permission.guard'),{Reflector}=require('@nestjs/core');
const {chatChainFixture:chain}=require('./master-r2-chat-fixture.cjs');
test('R2-E-J20 actual ownership message reader attachment controller revoke retry delete restore chain',()=>withIdentity(async()=>{
 const f=chain(),u=await f.context(f.user.userId),target=await f.context('membership-target');
 const transferred=await f.call(f.controller,'transferOwnership',u,[u,f.chat.id,{userId:target.userId,operationId:'ownership-transfer'}]);assert.equal(transferred.userId,target.userId);
 const body={text:'Проверьте ограждение линии',operationId:'message-operation'},message=await f.call(f.controller,'createMessage',u,[u,f.chat.id,body]);await f.service.markRead(u,f.chat.id);
 assert.equal(message.chatId,f.chat.id);assert.equal((await f.service.createMessage(u,f.chat.id,body)).id,message.id);await f.service.markRead(u,f.chat.id);
 const file=f.addFile(message),detail=await f.call(f.controller,'detail',target,[target,f.chat.id,{}]);assert.equal(detail.messages.find(r=>r.id===message.id).attachments[0].id,file.id);
 const metadata=await f.call(f.fileController,'metadata',target,[file.id,target]);assert.equal(metadata.id,file.id);assert.ok(!Object.hasOwn(metadata,'storagePath'));
 const headers={},response=strict({setHeader:(k,v)=>headers[k]=v,send:b=>{assert.equal(b.toString(),'Изолированное содержимое');}});await f.call(f.fileController,'file',target,[file.id,target,response]);assert.equal(headers['Content-Type'],'text/plain');assert.equal(f.storageReads.length,1);
 await f.call(f.controller,'removeMember',target,[target,f.chat.id,u.userId,{operationId:'remove-old-owner'}]);
 const before=JSON.stringify({messages:f.messages,files:f.files}),writes=f.writes.length;
 for(const probe of [()=>f.service.detail(u,f.chat.id),()=>f.service.createMessage(u,f.chat.id,body),()=>f.service.transferOwnership(u,f.chat.id,{userId:target.userId,operationId:'ownership-transfer'}),()=>f.service.deleteMessage(u,f.chat.id,message.id),()=>f.attachments.getMetadata(u,file.id),()=>f.attachments.getFile(u,file.id),()=>f.attachments.deactivate(u,file.id)])await assert.rejects(probe(),denied);
 assert.equal(f.writes.length,writes);assert.equal(JSON.stringify({messages:f.messages,files:f.files}),before);assert.equal(f.storageReads.length,1);
 await f.service.addMember(target,f.chat.id,{userId:u.userId,operationId:'restore-old-owner'});assert.equal((await f.service.detail(u,f.chat.id)).messages.find(r=>r.id===message.id).id,message.id);assert.equal((await f.attachments.getMetadata(u,file.id)).id,file.id);
 const nonAuthor=await f.context('membership-third');await assert.rejects(f.service.deleteMessage(nonAuthor,f.chat.id,message.id),denied);await assert.rejects(f.attachments.deactivate(nonAuthor,file.id),denied);
}));
for(const tombstone of ['removedAt','leftAt'])for(const reader of ['getMetadata','getFile'])test(`R2-E-J20 ${tombstone} active flags cannot override canonical denied chat attachment ${reader}`,()=>withIdentity(async()=>{
 const f=chain(),u=await f.context(f.user.userId),message=await f.service.createMessage(u,f.chat.id,{text:'Проверка крепления',operationId:'tombstone-message'});await f.service.markRead(u,f.chat.id);const file=f.addFile(message);
 f.members[0][tombstone]=new Date(); // persisted legacy/tombstone precondition; do not assume canRead is enough.
 await assert.rejects(f.service.detail(u,f.chat.id),denied);await assert.rejects(f.attachments[reader](u,file.id),denied);assert.equal(f.storageReads.length,0);
}));
