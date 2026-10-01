import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { ArchiveController } from './archive.controller';
import { ArchiveService } from './archive.service';
import { ArchiveXlsxService } from './archive-xlsx.service';

@Module({
  imports: [PrismaModule],
  controllers: [ArchiveController],
  providers: [ArchiveService, ArchiveXlsxService],
})
export class ArchiveModule {}
