import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { AssignmentModule } from './modules/assignment/assignment.module';
import { LineModule } from './modules/line/line.module';
import { TaskModule } from './modules/task/task.module';
import { WashModule } from './modules/wash/wash.module';
import { OkkModule } from './modules/okk/okk.module';
import { StockModule } from './modules/stock/stock.module';
import { ReturnsModule } from './modules/returns/returns.module';
import { ShiftLogModule } from './modules/shift-log/shift-log.module';
import { WsModule } from './ws/ws.module';
import { UserContextMiddleware } from './common/user-context.middleware';
import { UserContextService } from './common/user-context.service';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './modules/auth/auth.module';
import { AdminModule } from './modules/admin/admin.module';
import { AttachmentsModule } from './modules/attachments/attachments.module';
import { APP_GUARD } from '@nestjs/core';
import { PermissionGuard } from './common/permission.guard';
import { AuditModule } from './common/audit.module';
import { ShiftModule } from './modules/shift/shift.module';
import { PeopleModule } from './modules/people/people.module';
import { OrdersModule } from './modules/orders/orders.module';
import { ChecklistsModule } from './modules/checklists/checklists.module';
import { DefrostModule } from './modules/defrost/defrost.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { OpsModule } from './modules/ops/ops.module';
import { HealthModule } from './modules/health/health.module';
import { ChatsModule } from './modules/chats/chats.module';
import { DirectoryModule } from './modules/directory/directory.module';
import { AnnouncementsModule } from './modules/announcements/announcements.module';
import { ArchiveModule } from './modules/archive/archive.module';
import { WorkAreasModule } from './modules/work-areas/work-areas.module';
import { ErrorReportModule } from './modules/error-report/error-report.module';

@Module({
  imports: [PrismaModule, AuditModule, HealthModule, AuthModule, AdminModule, AttachmentsModule, PeopleModule, DirectoryModule, NotificationsModule, OpsModule, OrdersModule, ChecklistsModule, DefrostModule, ChatsModule, AnnouncementsModule, ArchiveModule, WorkAreasModule, ErrorReportModule, WsModule, ShiftModule, AssignmentModule, LineModule, TaskModule, WashModule, OkkModule, StockModule, ReturnsModule, ShiftLogModule],
  providers: [
    UserContextService,
    { provide: APP_GUARD, useClass: PermissionGuard },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(UserContextMiddleware).forRoutes('*');
  }
}
