import { Global, Module } from '@nestjs/common';
import { PushService } from '../push/push.service';
import { PrismaModule } from '../prisma/prisma.module';
import { WsService } from './ws.service';

@Global()
@Module({
  imports: [PrismaModule],
  providers: [WsService, PushService],
  exports: [WsService, PushService],
})
export class WsModule {}
