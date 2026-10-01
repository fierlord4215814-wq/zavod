import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { CurrentUser } from '../../common/current-user.decorator';
import { RequirePermission } from '../../common/require-permission.decorator';
import { UserContext } from '../../common/user-context.types';
import { PeopleService } from './people.service';

@Controller('people')
export class PeopleController {
  constructor(private readonly peopleService: PeopleService) {}

  @Get()
  async list(@CurrentUser() user: UserContext, @Query() query: any) {
    return this.peopleService.list(user, query);
  }

  @Get('search')
  @RequirePermission(['people.profile.read', 'people.read', 'assignments.manage'])
  async search(@CurrentUser() user: UserContext, @Query() query: any) {
    return this.peopleService.search(user, query);
  }

  @Get(':id/profile')
  async profileLegacy(@Param('id') id: string, @CurrentUser() user: UserContext) {
    return this.peopleService.profile(user, id);
  }

  @Get(':id')
  async profile(@Param('id') id: string, @CurrentUser() user: UserContext) {
    return this.peopleService.profile(user, id);
  }

  @Post(':id/photo')
  @UseInterceptors(FileInterceptor('file'))
  async uploadProfilePhoto(@Param('id') id: string, @UploadedFile() file: any, @CurrentUser() user: UserContext) {
    return this.peopleService.uploadProfilePhoto(user, id, file);
  }

  @Delete(':id/photo')
  async deleteProfilePhoto(@Param('id') id: string, @CurrentUser() user: UserContext) {
    return this.peopleService.deleteProfilePhoto(user, id);
  }

  @Post(':id/skills')
  @RequirePermission('people.skills.manage')
  async createSkill(@Param('id') id: string, @CurrentUser() user: UserContext, @Body() body: any) {
    return this.peopleService.createSkill(user, id, body);
  }

  @Patch(':id/skills/:skillId')
  @RequirePermission('people.skills.manage')
  async updateSkill(@Param('id') id: string, @Param('skillId') skillId: string, @CurrentUser() user: UserContext, @Body() body: any) {
    return this.peopleService.updateSkill(user, id, skillId, body);
  }

  @Post(':id/skills/:skillId/recommend')
  @RequirePermission('people.recommendations.manage')
  async recommendSkill(@Param('id') id: string, @Param('skillId') skillId: string, @CurrentUser() user: UserContext, @Body() body: any) {
    return this.peopleService.recommendSkill(user, id, skillId, body);
  }

  @Post(':id/notes')
  @RequirePermission('people.notes.manage')
  async createNote(@Param('id') id: string, @CurrentUser() user: UserContext, @Body() body: any) {
    return this.peopleService.createNote(user, id, body);
  }

  @Patch(':id/notes/:noteId')
  @RequirePermission('people.notes.manage')
  async updateNote(@Param('id') id: string, @Param('noteId') noteId: string, @CurrentUser() user: UserContext, @Body() body: any) {
    return this.peopleService.updateNote(user, id, noteId, body);
  }

  @Delete(':id/notes/:noteId')
  @RequirePermission('people.notes.manage')
  async deleteNote(@Param('id') id: string, @Param('noteId') noteId: string, @CurrentUser() user: UserContext) {
    return this.peopleService.deleteNote(user, id, noteId);
  }
}
