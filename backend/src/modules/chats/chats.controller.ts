import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { CurrentUser } from '../../common/current-user.decorator';
import { RequirePermission } from '../../common/require-permission.decorator';
import { UserContext } from '../../common/user-context.types';
import { ChatsService } from './chats.service';

@Controller()
@RequirePermission('chats.access')
export class ChatsController {
  constructor(private readonly chatsService: ChatsService) {}

  @Get('chats')
  list(@CurrentUser() user: UserContext, @Query() query: any) {
    return this.chatsService.list(user, query);
  }

  @Get('chats/:id')
  detail(@CurrentUser() user: UserContext, @Param('id') id: string, @Query() query: any) {
    return this.chatsService.detail(user, id, query);
  }

  @Post('chats')
  @RequirePermission('chats.manage')
  create(@CurrentUser() user: UserContext, @Body() body: any) {
    return this.chatsService.create(user, body);
  }

  @Post('chats/direct/:userId')
  createDirect(@CurrentUser() user: UserContext, @Param('userId') userId: string) {
    return this.chatsService.createDirect(user, userId);
  }

  @Patch('chats/:id')
  @RequirePermission('chats.manage')
  update(@CurrentUser() user: UserContext, @Param('id') id: string, @Body() body: any) {
    return this.chatsService.update(user, id, body);
  }

  @Get('chats/:id/media')
  media(@CurrentUser() user: UserContext, @Param('id') id: string) {
    return this.chatsService.media(user, id);
  }

  @Post('chats/:id/hide-for-me')
  hideForMe(@CurrentUser() user: UserContext, @Param('id') id: string) {
    return this.chatsService.hideForMe(user, id);
  }

  @Get('chats/:id/members')
  members(@CurrentUser() user: UserContext, @Param('id') id: string) {
    return this.chatsService.members(user, id);
  }

  @Post('chats/:id/members')
  addMember(@CurrentUser() user: UserContext, @Param('id') id: string, @Body() body: any) {
    return this.chatsService.addMember(user, id, body);
  }

  @Delete('chats/:id/members/:userId')
  removeMemberLegacy(@CurrentUser() user: UserContext, @Param('id') id: string, @Param('userId') userId: string, @Body() body: any) {
    return this.chatsService.removeMember(user, id, userId, body);
  }

  @Post('chats/:id/members/:userId/remove')
  removeMember(@CurrentUser() user: UserContext, @Param('id') id: string, @Param('userId') userId: string, @Body() body: any) {
    return this.chatsService.removeMember(user, id, userId, body);
  }

  @Post('chats/:id/members/:userId/role')
  updateMemberRole(@CurrentUser() user: UserContext, @Param('id') id: string, @Param('userId') userId: string, @Body() body: any) {
    return this.chatsService.updateMemberRole(user, id, userId, body);
  }

  @Post('chats/:id/leave')
  leave(@CurrentUser() user: UserContext, @Param('id') id: string, @Body() body: any) {
    return this.chatsService.leave(user, id, body);
  }

  @Post('chats/:id/transfer-ownership')
  transferOwnership(@CurrentUser() user: UserContext, @Param('id') id: string, @Body() body: any) {
    return this.chatsService.transferOwnership(user, id, body);
  }

  @Post('chats/:id/communication-block')
  setDirectCommunicationBlock(@CurrentUser() user: UserContext, @Param('id') id: string, @Body() body: any) {
    return this.chatsService.setDirectCommunicationBlock(user, id, body);
  }

  @Post('chats/:id/messages')
  createMessage(@CurrentUser() user: UserContext, @Param('id') id: string, @Body() body: any) {
    return this.chatsService.createMessage(user, id, body);
  }

  @Patch('chats/:id/messages/:messageId')
  updateMessage(@CurrentUser() user: UserContext, @Param('id') id: string, @Param('messageId') messageId: string, @Body() body: any) {
    return this.chatsService.updateMessage(user, id, messageId, body);
  }

  @Delete('chats/:id/messages/:messageId')
  deleteMessage(@CurrentUser() user: UserContext, @Param('id') id: string, @Param('messageId') messageId: string) {
    return this.chatsService.deleteMessage(user, id, messageId);
  }

  @Post('chats/:id/messages/:messageId/reactions')
  toggleReaction(@CurrentUser() user: UserContext, @Param('id') id: string, @Param('messageId') messageId: string, @Body() body: any) {
    return this.chatsService.toggleReaction(user, id, messageId, body);
  }

  @Post('chats/:id/polls')
  createPoll(@CurrentUser() user: UserContext, @Param('id') id: string, @Body() body: any) {
    return this.chatsService.createPoll(user, id, body);
  }

  @Post('chats/:id/polls/:pollId/vote')
  votePoll(@CurrentUser() user: UserContext, @Param('id') id: string, @Param('pollId') pollId: string, @Body() body: any) {
    return this.chatsService.votePoll(user, id, pollId, body);
  }

  @Post('chats/:id/read')
  markRead(@CurrentUser() user: UserContext, @Param('id') id: string) {
    return this.chatsService.markRead(user, id);
  }

  @Get('admin/chat-settings')
  @RequirePermission('chats.settings.read')
  settings(@CurrentUser() user: UserContext) {
    return this.chatsService.settings(user);
  }

  @Post('admin/chat-settings/preview')
  @RequirePermission('chats.settings.manage')
  previewSettings(@CurrentUser() user: UserContext, @Body() body: any) {
    return this.chatsService.previewSettings(user, body);
  }

  @Patch('admin/chat-settings')
  @RequirePermission('chats.settings.manage')
  updateSettings(@CurrentUser() user: UserContext, @Body() body: any) {
    return this.chatsService.updateSettings(user, body);
  }
}
