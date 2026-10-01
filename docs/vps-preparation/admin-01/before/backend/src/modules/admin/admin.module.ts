import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { LineModule } from '../line/line.module';

@Module({
  imports: [PrismaModule, LineModule],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
