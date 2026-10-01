import { Module } from '@nestjs/common';
import { AttachmentsModule } from '../attachments/attachments.module';
import { PrismaModule } from '../../prisma/prisma.module';
import { PeopleController } from './people.controller';
import { PeopleService } from './people.service';

@Module({
  imports: [PrismaModule, AttachmentsModule],
  controllers: [PeopleController],
  providers: [PeopleService],
})
export class PeopleModule {}
