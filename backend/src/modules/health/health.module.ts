import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { PrismaModule } from '../../prisma/prisma.module';
import { ReadinessService } from './readiness.service';

@Module({
  imports: [PrismaModule],
  controllers: [HealthController],
  providers: [ReadinessService],
  exports: [ReadinessService],
})
export class HealthModule {}
