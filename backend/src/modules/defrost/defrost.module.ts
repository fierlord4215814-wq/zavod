import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { LineModule } from '../line/line.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { DefrostController } from './defrost.controller';
import { DefrostService } from './defrost.service';
import { ChamberService } from './chamber.service';

@Module({
  imports: [PrismaModule, NotificationsModule, LineModule],
  controllers: [DefrostController],
  providers: [DefrostService, ChamberService],
  exports: [DefrostService, ChamberService],
})
export class DefrostModule {}
