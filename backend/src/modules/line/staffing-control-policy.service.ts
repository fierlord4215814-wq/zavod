import { ForbiddenException, Injectable } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { UserContext } from '../../common/user-context.types';
import { PrismaService } from '../../prisma/prisma.service';

export type StaffingControlDecision = {
  allowed: boolean;
  reason: string | null;
  mode: 'ADMIN' | 'PRODUCTION_MANAGER' | 'JOB_TITLE_HIERARCHY' | 'DENIED';
  jobTitleName: string | null;
};

@Injectable()
export class StaffingControlPolicyService {
  constructor(private readonly prisma: PrismaService) {}

  async decision(user: UserContext): Promise<StaffingControlDecision> {
    if (user.isAdmin && user.role === UserRole.ADMIN) {
      return { allowed: true, reason: null, mode: 'ADMIN', jobTitleName: null };
    }
    if (user.role === UserRole.MANAGEMENT && !user.isGuest
      && user.permissions.includes('lines.manage') && user.permissions.includes('admin.users.manage')) {
      const [access, authority] = await Promise.all([
        this.prisma.db.userFactoryAccess.findUnique({
          where: { userId_factoryId: { userId: user.userId, factoryId: user.selectedFactoryId } },
          include: { user: true, factory: true, jobTitle: true },
        }),
        this.prisma.db.userPermissionOverride.findUnique({
          where: { userId_factoryId_permissionCode: { userId: user.userId, factoryId: user.selectedFactoryId, permissionCode: 'admin.users.manage' } },
        }),
      ]);
      if (access?.isActive && !access.isGuest && access.role === UserRole.MANAGEMENT
        && !access.user.blockedAt && !access.user.deletedAt && !access.user.passwordResetRequired
        && access.factory.isActive && !access.factory.deletedAt
        && access.jobTitle?.factoryId === user.selectedFactoryId && access.jobTitle.baseRole === UserRole.MANAGEMENT
        && access.jobTitle.isActive && !access.jobTitle.deletedAt
        && authority?.effect === 'ALLOW') {
        return { allowed: true, reason: null, mode: 'PRODUCTION_MANAGER', jobTitleName: access.jobTitle.name };
      }
    }
    if (user.role !== UserRole.MASTER
      || !user.permissions.includes('lines.manage')
      || !user.permissions.includes('admin.users.manage')) {
      return {
        allowed: false,
        reason: 'Управление шаблонами состава доступно администратору или руководителю мастеров.',
        mode: 'DENIED',
        jobTitleName: null,
      };
    }

    const access = await this.prisma.db.userFactoryAccess.findUnique({
      where: { userId_factoryId: { userId: user.userId, factoryId: user.selectedFactoryId } },
      include: { user: true, jobTitle: true },
    });
    if (!access?.isActive
      || access.isGuest
      || access.role !== UserRole.MASTER
      || access.role !== user.role
      || access.user.blockedAt
      || access.user.deletedAt
      || !access.departmentId
      || !access.jobTitleId
      || !access.jobTitle?.isActive
      || access.jobTitle.deletedAt) {
      return {
        allowed: false,
        reason: 'Для управления составом нужна активная должность руководителя в выбранном заводе и отделе.',
        mode: 'DENIED',
        jobTitleName: access?.jobTitle?.name ?? null,
      };
    }

    const subordinateTitles = await this.prisma.db.jobTitle.count({
      where: {
        parentJobTitleId: access.jobTitleId,
        baseRole: UserRole.MASTER,
        departmentId: access.departmentId,
        isActive: true,
        deletedAt: null,
        OR: [{ factoryId: user.selectedFactoryId }, { factoryId: null }],
      },
    });
    if (!subordinateTitles) {
      return {
        allowed: false,
        reason: 'В иерархии должностей нет подчинённых должностей мастеров.',
        mode: 'DENIED',
        jobTitleName: access.jobTitle.name,
      };
    }

    return {
      allowed: true,
      reason: null,
      mode: 'JOB_TITLE_HIERARCHY',
      jobTitleName: access.jobTitle.name,
    };
  }

  async assertCanManage(user: UserContext) {
    const decision = await this.decision(user);
    if (!decision.allowed) {
      throw new ForbiddenException({ code: 'FORBIDDEN', message: decision.reason });
    }
    return decision;
  }
}
