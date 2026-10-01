import { Body, Controller, Delete, Get, Param, Post, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { AttachmentEntityType, AttachmentKind } from '@prisma/client';
import { CurrentUser } from '../../common/current-user.decorator';
import { UserContext } from '../../common/user-context.types';
import { AttachmentsService } from './attachments.service';

class UploadAttachmentDto {
  entityType!: AttachmentEntityType;
  entityId!: string;
  kind!: AttachmentKind;
  operationId?: string;
}

@Controller('attachments')
export class AttachmentsController {
  constructor(private readonly attachmentsService: AttachmentsService) {}

  @Post('upload')
  @UseInterceptors(FileInterceptor('file'))
  async upload(
    @UploadedFile() file: any,
    @Body() body: UploadAttachmentDto,
    @CurrentUser() user: UserContext,
  ) {
    return this.attachmentsService.upload(user, file, {
      entityType: body.entityType,
      entityId: body.entityId,
      kind: body.kind,
      operationId: body.operationId,
    });
  }

  @Get(':id')
  async metadata(@Param('id') id: string, @CurrentUser() user: UserContext) {
    return this.attachmentsService.getMetadata(user, id);
  }

  @Get(':id/file')
  async file(@Param('id') id: string, @CurrentUser() user: UserContext, @Res() response: any) {
    const { attachment, buffer } = await this.attachmentsService.getFile(user, id);
    response.setHeader('Content-Type', attachment.mimeType);
    response.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(attachment.originalName)}"`);
    response.send(buffer);
  }

  @Delete(':id')
  async deactivate(@Param('id') id: string, @CurrentUser() user: UserContext) {
    return this.attachmentsService.deactivate(user, id);
  }
}
