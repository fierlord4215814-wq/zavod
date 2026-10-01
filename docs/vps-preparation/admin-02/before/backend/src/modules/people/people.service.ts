import { ForbiddenException, Injectable } from '@nestjs/common';
import { AssignmentKind, AttachmentEntityType, AttachmentKind, EmployeeState, Prisma, ShiftSessionStatus, ShiftType, ShiftWillBeStatus, TaskStatus, UserProfileNoteVisibility, UserRole } from '@prisma/client';
import { isAssignableEmployeeRole } from '../../common/assignment-eligibility';
import { AuditService } from '../../common/audit.service';
import { ConflictError } from '../../common/errors/conflict.exception';
import { hasPilotFixtureMarker, isDiagnosticFixtureActor, isPilotVisibleLine, pilotDisplayName } from '../../common/pilot-visibility';
import { addFactoryShifts, factoryShiftDate, factoryShiftTarget, factoryShiftWindow, type FactoryShiftTarget } from '../../common/shift-time';
import { canReadTask } from '../../common/task-visibility';
import { UserContext } from '../../common/user-context.types';
import { PrismaService } from '../../prisma/prisma.service';
import { normalizePhoneSearchDigits } from '../../common/password';
import { FileStorageService } from '../attachments/file-storage.service';

@Injectable()
export class PeopleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly storage: FileStorageService,
  ) {}

  async list(user: UserContext, query: any = {}) {
    if (user.isGuest) {
      await this.writeDenied(user, 'people list denied');
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Нет доступа к списку сотрудников' });
    }
    const canReadDirectory = user.isAdmin
      || user.permissions.includes('people.read')
      || user.permissions.includes('assignments.manage');
    const where: Prisma.UserFactoryAccessWhereInput = {
      factoryId: user.selectedFactoryId,
      isActive: true,
      isGuest: false,
      ...(query.role ? { role: query.role } : {}),
      ...(query.departmentId ? { departmentId: query.departmentId } : {}),
      user: {
        deletedAt: null,
        ...(query.status ? { employeeState: query.status as EmployeeState } : {}),
        ...(query.q ? { id: { contains: query.q, mode: 'insensitive' } } : {}),
      },
    };

    if (!canReadDirectory) {
      if (!user.isGuest && (user.role === UserRole.WORKER || user.role === UserRole.CONTRACTOR)) {
        where.OR = [
          { userId: user.userId },
          { role: { in: [UserRole.MASTER, UserRole.MANAGEMENT, UserRole.CONTRACTOR_LEAD] } },
        ];
      } else {
        where.userId = user.userId;
      }
    } else if (!user.isAdmin && user.role === UserRole.MANAGEMENT && user.departmentId) {
      where.departmentId = user.departmentId;
    } else if (user.role === UserRole.STORE) {
      where.role = { in: [UserRole.WORKER, UserRole.CONTRACTOR] };
      where.AND = [{
        user: {
          employeeState: EmployeeState.AVAILABLE,
          assignments: { none: { factoryId: user.selectedFactoryId, endedAt: null } },
        },
      }];
    } else if (user.role === UserRole.CONTRACTOR_LEAD) {
      if (user.companyId) where.companyId = user.companyId;
      else where.userId = user.userId;
    }

    const accessRows = await this.prisma.db.userFactoryAccess.findMany({
      where,
      include: {
        user: {
          include: {
            assignments: {
              where: this.currentAssignmentWhere(user.selectedFactoryId),
              include: { line: true, position: true, staffingTemplate: true },
              orderBy: { startedAt: 'desc' },
              take: 1,
            },
            shiftSessions: {
              where: { factoryId: user.selectedFactoryId, status: ShiftSessionStatus.ACTIVE },
              select: { id: true },
              orderBy: { startedAt: 'desc' },
              take: 1,
            },
            skills: {
              where: { factoryId: user.selectedFactoryId, isActive: true, experienceCount: { gt: 0 } },
              include: { line: true, position: true },
              take: 4,
            },
          },
        },
        department: true,
      },
      orderBy: [{ role: 'asc' }, { userId: 'asc' }],
    });

    const pilotRows = accessRows.filter((row) => !row.user.blockedAt && !isDiagnosticFixtureActor(row.user));
    const filtered = query.onShift === 'true'
      ? pilotRows.filter((row) => this.isOnShift(row.user, this.visibleCurrentAssignment(row.user)))
      : pilotRows;
    const visibleRows = filtered.slice(0, 200);
    const profilePhotos = await this.profilePhotosForUsers(user.selectedFactoryId, visibleRows.map((row) => row.userId));
    const people = visibleRows.map((row) => this.serializeListPerson(user, row, profilePhotos.get(row.userId) ?? null));
    const groups = people.reduce((acc, person) => {
      const key = person.departmentName || 'Без отдела';
      acc[key] = [...(acc[key] ?? []), person];
      return acc;
    }, {} as Record<string, any[]>);
    return { people, groups };
  }

  async search(user: UserContext, query: any = {}) {
    const mode = query.mode === 'ASSIGNMENT' ? 'ASSIGNMENT' : 'PEOPLE_DIRECTORY';
    const normalizedName = this.normalizePersonSearch(query.q);
    const normalizedDigits = this.normalizePhoneSearch(query.q);
    const nameAccepted = normalizedName.replace(/[^a-zа-я\s-]/gi, '').replace(/[\s-]/g, '').length >= 2;
    const phoneAccepted = normalizedDigits.length >= 4;
    const context = mode === 'ASSIGNMENT' ? this.resolveSearchShiftContext(query) : null;
    if (!nameAccepted && !phoneAccepted) {
      return {
        queryAccepted: false,
        message: 'Введите минимум 2 буквы или 4 цифры номера',
        context: context ? this.serializeSearchContext(context, query.context) : null,
        results: [],
      };
    }

    const canReadDirectory = user.isAdmin || user.permissions.includes('people.read') || user.permissions.includes('assignments.manage');
    const canAssign = user.isAdmin || user.permissions.includes('assignments.manage');
    if (mode === 'ASSIGNMENT' && !canAssign) {
      await this.writeDenied(user, 'people assignment search denied');
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Нет доступа к назначению сотрудников' });
    }

    const where: Prisma.UserFactoryAccessWhereInput = {
      factoryId: user.selectedFactoryId,
      isActive: true,
      deactivatedAt: null,
      isGuest: false,
      ...(mode === 'ASSIGNMENT' ? { role: { in: [UserRole.WORKER, UserRole.CONTRACTOR] } } : {}),
      user: { deletedAt: null, blockedAt: null },
    };
    if (!canReadDirectory) {
      where.userId = user.userId;
    } else if (mode === 'PEOPLE_DIRECTORY' && !user.isAdmin && user.role === UserRole.MANAGEMENT && user.departmentId) {
      where.departmentId = user.departmentId;
    } else if (mode === 'PEOPLE_DIRECTORY' && user.role === UserRole.STORE) {
      where.role = { in: [UserRole.WORKER, UserRole.CONTRACTOR] };
      where.AND = [{
        user: {
          employeeState: EmployeeState.AVAILABLE,
          assignments: { none: { factoryId: user.selectedFactoryId, endedAt: null } },
        },
      }];
    }

    const accessRows = await this.prisma.db.userFactoryAccess.findMany({
      where,
      include: {
        department: true,
        user: {
          include: {
            assignments: {
              where: { factoryId: user.selectedFactoryId, endedAt: null },
              include: { line: true, position: true },
              take: 1,
            },
          },
        },
      },
      orderBy: { userId: 'asc' },
      take: 500,
    });

    const matched = accessRows
      .filter((row) => !isDiagnosticFixtureActor(row.user))
      .filter((row) => mode !== 'ASSIGNMENT' || isAssignableEmployeeRole(row.role))
      .map((row) => {
        const displayName = pilotDisplayName(row.user);
        const searchableName = this.normalizePersonSearch(displayName);
        const digits = this.normalizePhoneSearch(row.user.normalizedPhone ?? row.user.phone ?? '');
        const nameMatch = nameAccepted && searchableName.includes(normalizedName);
        const phoneMatch = phoneAccepted && this.phoneIncludes(digits, normalizedDigits);
        if (!nameMatch && !phoneMatch) return null;
        const tokens = searchableName.split(' ').filter(Boolean);
        const rank = nameMatch
          ? searchableName === normalizedName
            ? 0
            : tokens.some((token) => token.startsWith(normalizedName))
              ? 1
              : 2
          : 3;
        return { row, displayName, nameMatch, phoneMatch, rank };
      })
      .filter((item): item is NonNullable<typeof item> => Boolean(item));

    const candidateIds = matched.map((item) => item.row.userId);
    const status = mode === 'ASSIGNMENT' && context
      ? await this.loadAssignmentSearchStatus(user.selectedFactoryId, candidateIds, context)
      : null;
    const results = matched.map((item) => {
      const assignmentStatus = status?.get(item.row.userId) ?? null;
      const currentAssignment = item.row.user.assignments[0] ?? null;
      const assignmentSummary = assignmentStatus?.assignmentSummary
        ?? (currentAssignment
          ? `${currentAssignment.line?.name ?? 'Назначение'}${currentAssignment.position?.name ? ` · ${currentAssignment.position.name}` : ''}`
          : null);
      const resultCanAssign = mode === 'ASSIGNMENT' && Boolean(assignmentStatus?.canAssign);
      return {
        userId: item.row.userId,
        displayName: item.displayName,
        role: item.row.role,
        roleLabel: this.roleLabel(item.row.role),
        departmentName: hasPilotFixtureMarker(item.row.department?.name) ? null : item.row.department?.name ?? null,
        phoneLabel: item.row.user.phone || item.row.user.normalizedPhone
          ? this.maskPhone(item.row.user.normalizedPhone ?? item.row.user.phone ?? '')
          : item.phoneMatch ? 'Совпадение по номеру' : null,
        matchedByPhone: item.phoneMatch && !item.nameMatch,
        presenceStatus: assignmentStatus?.presenceStatus ?? null,
        assignmentStatus: assignmentSummary ? 'Уже назначен' : assignmentStatus?.assignmentStatus ?? null,
        currentAssignmentSummary: assignmentSummary,
        canAssign: resultCanAssign,
        requiresManualAdd: Boolean(assignmentStatus?.requiresManualAdd),
        selfConfirmed: assignmentStatus?.selfConfirmed ?? null,
        reasonCode: mode === 'ASSIGNMENT' ? assignmentStatus?.reasonCode ?? null : null,
        reason: mode === 'ASSIGNMENT' ? assignmentStatus?.reason ?? null : null,
        relevanceRank: item.rank,
      };
    }).sort((a, b) => (
      a.relevanceRank - b.relevanceRank
      || Number(b.canAssign) - Number(a.canAssign)
      || Number(Boolean(b.requiresManualAdd)) - Number(Boolean(a.requiresManualAdd))
      || a.displayName.localeCompare(b.displayName, 'ru')
    )).slice(0, 20).map(({ relevanceRank: _rank, ...item }) => item);

    return {
      queryAccepted: true,
      message: results.length ? null : 'Сотрудник не найден',
      context: context ? this.serializeSearchContext(context, query.context) : null,
      results,
    };
  }

  async profile(user: UserContext, targetUserId: string) {
    if (user.isGuest) {
      await this.writeDenied(user, 'people profile read denied', targetUserId);
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Нет доступа к профилю' });
    }
    const target = await this.loadTarget(targetUserId, user.selectedFactoryId);
    if (!target) return null;
    await this.assertTargetScope(user, target);
    await this.assertCanReadProfile(user, target);
    if (user.role === UserRole.STORE && targetUserId !== user.userId) {
      const access = target.factoryAccess[0] ?? null;
      const isFreeAssignable = Boolean(
        access &&
        (access.role === UserRole.WORKER || access.role === UserRole.CONTRACTOR) &&
        target.employeeState === EmployeeState.AVAILABLE &&
        target.assignments.length === 0,
      );
      if (!isFreeAssignable) {
        await this.writeDenied(user, 'store people scope denied', targetUserId);
        throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Складу доступны только свободные работники и наёмные работники' });
      }
    }

    const skills = await this.prisma.db.userSkill.findMany({
      where: { factoryId: user.selectedFactoryId, userId: targetUserId, isActive: true, experienceCount: { gt: 0 } },
      include: { line: true, position: true, recommendedBy: { select: { id: true } } },
      orderBy: [{ updatedAt: 'desc' }],
    });
    const notes = await this.visibleNotes(user, targetUserId);
    // Keep loadTarget's unfiltered assignments for conservative access checks above.
    // The displayed assignment must use the same current projection as the directory.
    const currentAssignment = await this.prisma.db.assignment.findFirst({
      where: { ...this.currentAssignmentWhere(user.selectedFactoryId), userId: targetUserId },
      include: { line: true, position: true, staffingTemplate: true, workArea: true, workAreaPosition: true },
      orderBy: { startedAt: 'desc' },
    });
    const assignment = this.visibleCurrentAssignment({ assignments: currentAssignment ? [currentAssignment] : [] });
    const access = target.factoryAccess[0] ?? null;
    const targetRole = access?.role ?? target.role;
    const canReadPhone = this.canReadPhone(user, targetUserId, targetRole);
    const serviceTaskStatus = await this.serviceTaskStatus(user, targetUserId, access?.role ?? target.role);
    const profilePhoto = await this.activeProfilePhoto(user.selectedFactoryId, targetUserId);

    return {
      id: target.id,
      displayName: pilotDisplayName(target),
      role: targetRole,
      departmentId: access?.departmentId ?? null,
      departmentName: access?.department?.name ?? null,
      phone: canReadPhone ? target.phone : null,
      phoneLabel: canReadPhone ? target.phone ?? 'Телефон не указан' : 'Телефон скрыт',
      profilePhoto: this.serializeProfilePhoto(profilePhoto),
      factoryAccesses: target.factoryAccess.map((item) => ({
        factoryId: item.factoryId,
        factoryName: item.factory.name,
        role: item.role,
        departmentId: item.departmentId,
        departmentName: item.department?.name ?? null,
        isActive: item.isActive,
      })),
      employeeState: target.employeeState,
      onShift: this.isOnShift(target, assignment),
      currentAssignment: assignment
        ? {
            kind: assignment.kind,
            lineId: assignment.lineId,
            lineName: assignment.line?.name ?? null,
            positionId: assignment.positionId,
            positionName: assignment.position?.name ?? null,
            staffingTemplateId: assignment.staffingTemplateId,
            staffingTemplateName: assignment.staffingTemplate?.name ?? null,
            workAreaName: assignment.workArea?.name ?? null,
            workAreaPositionName: assignment.workAreaPosition?.title ?? null,
            slotIndex: assignment.slotIndex ?? null,
            washSessionId: assignment.washSessionId,
            timeRoleName: assignment.timeRoleName,
            startedAt: assignment.startedAt,
          }
        : null,
      skills: skills.map((skill) => this.serializeSkill(skill)),
      notes,
      serviceTaskStatus,
      availableActions: this.availableProfileActions(user, target, targetRole),
      sections: {
        skills: skills.length ? `${skills.length} навыков` : 'Навыки пока не указаны',
        recommendations: skills.some((skill) => skill.recommendedAt) ? 'Есть рекомендации' : 'Рекомендаций пока нет',
        comments: notes.length ? `${notes.length} заметок` : this.canReadNotes(user) ? 'Заметок пока нет' : null,
      },
    };
  }

  async createSkill(user: UserContext, targetUserId: string, body: any) {
    const target = await this.loadTargetOrThrow(targetUserId, user.selectedFactoryId);
    await this.assertCanManageProfile(user, target, 'Нет доступа к управлению навыками');
    const { line, position } = await this.validateLinePosition(user.selectedFactoryId, body.lineId, body.positionId);
    const existing = await this.prisma.db.userSkill.findFirst({
      where: { factoryId: user.selectedFactoryId, userId: targetUserId, lineId: line.id, positionId: position.id, isActive: true },
      include: { line: true, position: true, recommendedBy: { select: { id: true } } },
    });
    if (existing) return this.serializeSkill(existing);
    const experienceCount = this.nonNegativeInt(body.experienceCount ?? 1, 'Количество опыта должно быть неотрицательным целым числом');
    if (experienceCount < 1) throw new ConflictError('Укажите фактический опыт от 1');
    const skill = await this.prisma.db.userSkill.create({
      data: {
        factoryId: user.selectedFactoryId,
        userId: targetUserId,
        lineId: line.id,
        positionId: position.id,
        skillFamilyKey: position.skillFamilyKey,
        experienceCount,
      },
      include: { line: true, position: true, recommendedBy: { select: { id: true } } },
    });
    await this.auditService.write({
      userId: user.userId,
      factoryId: user.selectedFactoryId,
      action: 'USER_SKILL_CREATED',
      entityType: 'UserSkill',
      entityId: skill.id,
      details: { targetUserId, lineId: line.id, positionId: position.id, experienceCount },
    });
    return this.serializeSkill(skill);
  }

  async updateSkill(user: UserContext, targetUserId: string, skillId: string, body: any) {
    const target = await this.loadTargetOrThrow(targetUserId, user.selectedFactoryId);
    await this.assertCanManageProfile(user, target, 'Нет доступа к управлению навыками');
    const current = await this.prisma.db.userSkill.findFirst({ where: { id: skillId, factoryId: user.selectedFactoryId, userId: targetUserId } });
    if (!current) throw new ConflictError('Навык не найден');
    const data: Prisma.UserSkillUpdateInput = {};
    let resetToZero = false;
    if (body.experienceCount !== undefined) {
      const experienceCount = this.nonNegativeInt(body.experienceCount, 'Количество опыта должно быть неотрицательным целым числом');
      data.experienceCount = experienceCount;
      resetToZero = experienceCount === 0;
    }
    if (typeof body.isActive === 'boolean') data.isActive = body.isActive;
    if (body.isActive === false) data.deactivatedAt = new Date();
    if (resetToZero) {
      data.isActive = false;
      data.deactivatedAt = new Date();
    }
    const updated = await this.prisma.db.userSkill.update({
      where: { id: skillId },
      data,
      include: { line: true, position: true, recommendedBy: { select: { id: true } } },
    });
    await this.auditService.write({
      userId: user.userId,
      factoryId: user.selectedFactoryId,
      action: 'USER_SKILL_UPDATED',
      entityType: 'UserSkill',
      entityId: skillId,
      details: { targetUserId, oldValue: this.cleanSkill(current), newValue: this.cleanSkill(updated) },
    });
    return this.serializeSkill(updated);
  }

  async recommendSkill(user: UserContext, targetUserId: string, skillId: string, body: any) {
    const target = await this.loadTargetOrThrow(targetUserId, user.selectedFactoryId);
    await this.assertCanManageProfile(user, target, 'Нет доступа к рекомендациям');
    const skill = await this.prisma.db.userSkill.findFirst({ where: { id: skillId, factoryId: user.selectedFactoryId, userId: targetUserId, isActive: true } });
    if (!skill) throw new ConflictError('Активный навык не найден');
    const updated = await this.prisma.db.userSkill.update({
      where: { id: skillId },
      data: { recommendedById: user.userId, recommendedAt: new Date(), recommendationComment: String(body.comment ?? '').trim() || null },
      include: { line: true, position: true, recommendedBy: { select: { id: true } } },
    });
    await this.auditService.write({
      userId: user.userId,
      factoryId: user.selectedFactoryId,
      action: 'USER_SKILL_RECOMMENDED',
      entityType: 'UserSkill',
      entityId: skillId,
      details: { targetUserId, comment: body.comment ?? null },
    });
    return this.serializeSkill(updated);
  }

  async createNote(user: UserContext, targetUserId: string, body: any) {
    const target = await this.loadTargetOrThrow(targetUserId, user.selectedFactoryId);
    await this.assertCanManageNotes(user, target);
    const visibility = body.visibility === UserProfileNoteVisibility.ADMIN ? UserProfileNoteVisibility.ADMIN : UserProfileNoteVisibility.MANAGEMENT;
    if (visibility === UserProfileNoteVisibility.ADMIN && !user.isAdmin) throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Заметка только для администратора недоступна' });
    const note = await this.prisma.db.userProfileNote.create({
      data: { factoryId: user.selectedFactoryId, userId: targetUserId, authorId: user.userId, text: this.requiredText(body.text, 'Текст заметки обязателен'), visibility },
    });
    await this.auditService.write({ userId: user.userId, factoryId: user.selectedFactoryId, action: 'USER_PROFILE_NOTE_CREATED', entityType: 'UserProfileNote', entityId: note.id, details: { targetUserId, visibility } });
    return note;
  }

  async updateNote(user: UserContext, targetUserId: string, noteId: string, body: any) {
    const target = await this.loadTargetOrThrow(targetUserId, user.selectedFactoryId);
    await this.assertCanManageNotes(user, target);
    const current = await this.prisma.db.userProfileNote.findFirst({ where: { id: noteId, factoryId: user.selectedFactoryId, userId: targetUserId, deletedAt: null } });
    if (!current) throw new ConflictError('Заметка не найдена');
    if (current.visibility === UserProfileNoteVisibility.ADMIN && !user.isAdmin) throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Заметка только для администратора недоступна' });
    const updated = await this.prisma.db.userProfileNote.update({ where: { id: noteId }, data: { text: this.requiredText(body.text, 'Текст заметки обязателен') } });
    await this.auditService.write({ userId: user.userId, factoryId: user.selectedFactoryId, action: 'USER_PROFILE_NOTE_UPDATED', entityType: 'UserProfileNote', entityId: noteId, details: { targetUserId } });
    return updated;
  }

  async deleteNote(user: UserContext, targetUserId: string, noteId: string) {
    const target = await this.loadTargetOrThrow(targetUserId, user.selectedFactoryId);
    await this.assertCanManageNotes(user, target);
    const current = await this.prisma.db.userProfileNote.findFirst({ where: { id: noteId, factoryId: user.selectedFactoryId, userId: targetUserId, deletedAt: null } });
    if (!current) throw new ConflictError('Заметка не найдена');
    if (current.visibility === UserProfileNoteVisibility.ADMIN && !user.isAdmin) throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Заметка только для администратора недоступна' });
    const updated = await this.prisma.db.userProfileNote.update({ where: { id: noteId }, data: { deletedAt: new Date() } });
    await this.auditService.write({ userId: user.userId, factoryId: user.selectedFactoryId, action: 'USER_PROFILE_NOTE_DELETED', entityType: 'UserProfileNote', entityId: noteId, details: { targetUserId } });
    return updated;
  }

  async uploadProfilePhoto(
    user: UserContext,
    targetUserId: string,
    file: { buffer: Buffer; originalname: string; mimetype: string; size: number } | undefined,
  ) {
    const target = await this.loadTargetOrThrow(targetUserId, user.selectedFactoryId);
    await this.assertCanManageProfilePhoto(user, target);
    if (!file) throw new ConflictError('Выберите фото сотрудника');
    if (!/^image\/(jpeg|png|webp|gif)$/.test(file.mimetype)) {
      throw new ConflictError('Фото профиля должно быть изображением: JPG, PNG, WEBP или GIF');
    }
    if (file.size > 5 * 1024 * 1024) {
      throw new ConflictError('Фото профиля не должно быть больше 5 МБ');
    }

    const originalName = this.normalizeOriginalName(file.originalname);
    const saved = await this.storage.saveUploadedFile({
      buffer: file.buffer,
      originalName,
      mimeType: file.mimetype,
      kind: AttachmentKind.PHOTO,
      entityType: AttachmentEntityType.COMMON,
    });
    const operationId = `profile-photo:${user.selectedFactoryId}:${targetUserId}:${Date.now()}:${Math.random().toString(36).slice(2)}`;

    const attachment = await this.prisma.db.$transaction(async (tx) => {
      await tx.attachment.updateMany({
        where: {
          factoryId: user.selectedFactoryId,
          entityType: AttachmentEntityType.COMMON,
          entityId: targetUserId,
          kind: AttachmentKind.PHOTO,
          operationId: { startsWith: `profile-photo:${user.selectedFactoryId}:${targetUserId}:` },
          deletedAt: null,
        },
        data: { deletedAt: new Date() },
      });
      const created = await tx.attachment.create({
        data: {
          factoryId: user.selectedFactoryId,
          uploadedById: user.userId,
          entityType: AttachmentEntityType.COMMON,
          entityId: targetUserId,
          kind: AttachmentKind.PHOTO,
          operationId,
          originalName,
          mimeType: file.mimetype,
          sizeBytes: saved.sizeBytes,
          storagePath: saved.storagePath,
        },
      });
      const updated = await tx.attachment.update({
        where: { id: created.id },
        data: { publicUrl: this.storage.buildSafeUrl(created.id) },
      });
      await this.auditService.writeTx(tx, {
        userId: user.userId,
        factoryId: user.selectedFactoryId,
        action: 'USER_PROFILE_PHOTO_UPDATED',
        entityType: 'User',
        entityId: targetUserId,
        details: { attachmentId: updated.id, mimeType: file.mimetype, sizeBytes: saved.sizeBytes },
      });
      return updated;
    });

    return this.serializeProfilePhoto(attachment);
  }

  async deleteProfilePhoto(user: UserContext, targetUserId: string) {
    const target = await this.loadTargetOrThrow(targetUserId, user.selectedFactoryId);
    await this.assertCanManageProfilePhoto(user, target);
    const current = await this.activeProfilePhoto(user.selectedFactoryId, targetUserId);
    if (!current) return { success: true, profilePhoto: null };

    await this.prisma.db.$transaction(async (tx) => {
      await tx.attachment.update({ where: { id: current.id }, data: { deletedAt: new Date() } });
      await this.auditService.writeTx(tx, {
        userId: user.userId,
        factoryId: user.selectedFactoryId,
        action: 'USER_PROFILE_PHOTO_DELETED',
        entityType: 'User',
        entityId: targetUserId,
        details: { attachmentId: current.id },
      });
    });
    return { success: true, profilePhoto: null };
  }

  private async loadTarget(userId: string, factoryId: string) {
    return this.prisma.db.user.findUnique({
      where: { id: userId },
      include: {
        factoryAccess: {
          where: { factoryId },
          include: { factory: true, department: true },
          take: 1,
        },
        assignments: {
          where: { factoryId, endedAt: null },
          include: { line: true, position: true, staffingTemplate: true, workArea: true, workAreaPosition: true },
          take: 1,
        },
        shiftSessions: {
          where: { factoryId, status: ShiftSessionStatus.ACTIVE },
          select: { id: true },
          orderBy: { startedAt: 'desc' },
          take: 1,
        },
      },
    });
  }

  private async loadTargetOrThrow(userId: string, factoryId: string) {
    const target = await this.loadTarget(userId, factoryId);
    if (!target) throw new ConflictError('Пользователь не найден');
    await this.assertTargetScope({ selectedFactoryId: factoryId } as UserContext, target, true);
    return target;
  }

  private async assertCanReadProfile(user: UserContext, target: any) {
    if (target.id === user.userId) return;
    if (
      user.isAdmin
      || user.permissions.includes('people.read')
      || user.permissions.includes('assignments.manage')
      || user.permissions.includes('users.manage')
      || user.permissions.includes('admin.read')
    ) return;
    const targetRole = target.factoryAccess[0]?.role ?? target.role;
    if (
      !user.isGuest
      && (user.role === UserRole.WORKER || user.role === UserRole.CONTRACTOR)
      && ([UserRole.MASTER, UserRole.MANAGEMENT, UserRole.CONTRACTOR_LEAD] as UserRole[]).includes(targetRole)
    ) {
      return;
    }
    await this.writeDenied(user, 'people profile read denied', target.id);
    throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Нет доступа к профилю' });
  }

  private async assertTargetScope(user: UserContext, target: any, skipUserCheck = false) {
    const access = target.factoryAccess[0] ?? null;
    if (!access) {
      if (!skipUserCheck) await this.writeDenied(user, 'user outside selected factory', target.id);
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Пользователь вне выбранного завода' });
    }
    if (!skipUserCheck && !user.isAdmin && user.role === UserRole.MANAGEMENT && user.departmentId && access.departmentId !== user.departmentId && target.id !== user.userId) {
      await this.writeDenied(user, 'people department scope denied', target.id);
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Нет доступа к людям другого отдела' });
    }
    if (!skipUserCheck && !user.isAdmin && user.role === UserRole.CONTRACTOR_LEAD && target.id !== user.userId) {
      if (!user.companyId || access.companyId !== user.companyId) {
        await this.writeDenied(user, 'people company scope denied', target.id);
        throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Нет доступа к сотрудникам другой организации' });
      }
    }
  }

  private async assertCanManageProfile(user: UserContext, target: any, reason: string) {
    if (!user.isAdmin && !user.permissions.includes('people.skills.manage')) {
      await this.writeDenied(user, reason, target.id);
      throw new ForbiddenException({ code: 'FORBIDDEN', message: reason });
    }
    await this.assertTargetScope(user, target);
    const accessRole = target.factoryAccess[0]?.role;
    if (!user.isAdmin && user.role === UserRole.MASTER && ![UserRole.WORKER, UserRole.CONTRACTOR].includes(accessRole)) {
      await this.writeDenied(user, 'master skill target role denied', target.id);
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Мастер может управлять навыками только работников и наёмных работников' });
    }
  }

  private async assertCanManageNotes(user: UserContext, target: any) {
    if (!user.isAdmin && !user.permissions.includes('people.notes.manage')) {
      await this.writeDenied(user, 'people notes manage denied', target.id);
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Нет доступа к заметкам профиля' });
    }
    await this.assertTargetScope(user, target);
  }

  private async assertCanManageProfilePhoto(user: UserContext, target: any) {
    if (user.userId === target.id) {
      await this.writeDenied(user, 'people profile photo self update denied', target.id);
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Фото профиля ведёт мастер или руководитель' });
    }
    const allowedRole = user.isAdmin || new Set<string>([UserRole.MASTER, UserRole.MANAGEMENT, UserRole.ADMIN]).has(String(user.role));
    if (!allowedRole) {
      await this.writeDenied(user, 'people profile photo role denied', target.id);
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Фото профиля может менять только мастер или руководитель' });
    }
    await this.assertTargetScope(user, target);
    const accessRole = target.factoryAccess[0]?.role;
    if (!user.isAdmin && user.role === UserRole.MASTER && ![UserRole.WORKER, UserRole.CONTRACTOR].includes(accessRole)) {
      await this.writeDenied(user, 'master profile photo target role denied', target.id);
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Мастер может менять фото только работников и наёмных работников' });
    }
  }

  private async validateLinePosition(factoryId: string, lineId: string, positionId: string) {
    const line = await this.prisma.db.line.findFirst({ where: { id: lineId, factoryId, deletedAt: null } });
    if (!line) throw new ConflictError('Линия не найдена в выбранном заводе');
    const position = await this.prisma.db.linePosition.findFirst({ where: { id: positionId, lineId, factoryId, deletedAt: null } });
    if (!position) throw new ConflictError('Позиция не найдена на выбранной линии');
    return { line, position };
  }

  private async visibleNotes(user: UserContext, targetUserId: string) {
    if (!this.canReadNotes(user)) return [];
    const notes = await this.prisma.db.userProfileNote.findMany({
      where: {
        factoryId: user.selectedFactoryId,
        userId: targetUserId,
        deletedAt: null,
        ...(user.isAdmin ? {} : { visibility: UserProfileNoteVisibility.MANAGEMENT }),
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return notes;
  }

  private resolveSearchShiftContext(query: any): FactoryShiftTarget {
    const current = factoryShiftTarget();
    if (query.context !== 'FUTURE') return current;
    if (typeof query.shiftDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(query.shiftDate) && (query.shiftType === ShiftType.DAY || query.shiftType === ShiftType.NIGHT)) {
      return { shiftDate: query.shiftDate, shiftType: query.shiftType };
    }
    return addFactoryShifts(current, 1);
  }

  private serializeSearchContext(target: FactoryShiftTarget, requestedContext: unknown) {
    const [year, month, day] = target.shiftDate.split('-');
    const shiftLabel = target.shiftType === ShiftType.NIGHT ? 'Ночь' : 'День';
    return {
      kind: requestedContext === 'FUTURE' ? 'FUTURE' : 'CURRENT',
      shiftDate: target.shiftDate,
      shiftType: target.shiftType,
      label: `${requestedContext === 'FUTURE' ? 'Будущая' : 'Текущая'} смена: ${shiftLabel} ${day}.${month}.${year}`,
    };
  }

  private async loadAssignmentSearchStatus(factoryId: string, userIds: string[], target: FactoryShiftTarget) {
    const result = new Map<string, {
      presenceStatus: string;
      assignmentStatus: string;
      assignmentSummary: string | null;
      canAssign: boolean;
      requiresManualAdd: boolean;
      selfConfirmed: boolean | null;
      reasonCode: string | null;
      reason: string | null;
    }>();
    if (!userIds.length) return result;
    const current = factoryShiftTarget();
    const isCurrent = current.shiftDate === target.shiftDate && current.shiftType === target.shiftType;
    if (isCurrent) {
      const window = factoryShiftWindow(target);
      const [sessions, assignments, recentEndedAssignments, shiftSettings, sentHomeRows, approvedReturns] = await Promise.all([
        this.prisma.db.shiftSession.findMany({
          where: {
            factoryId,
            userId: { in: userIds },
            status: ShiftSessionStatus.ACTIVE,
            startedAt: { lt: window.to },
          },
          select: { userId: true },
        }),
        this.prisma.db.assignment.findMany({
          where: { factoryId, userId: { in: userIds }, endedAt: null },
          include: { line: true, position: true, workArea: true, workAreaPosition: true },
        }),
        this.prisma.db.assignment.findMany({
          where: { factoryId, userId: { in: userIds }, endedAt: { not: null } },
          select: { userId: true, endedAt: true },
          orderBy: { endedAt: 'desc' },
          take: Math.min(500, userIds.length * 3),
        }),
        this.prisma.db.shiftSettings.findUnique({ where: { factoryId }, select: { minAssignmentMoveIntervalMinutes: true } }),
        this.prisma.db.auditLog.findMany({
          where: {
            factoryId,
            action: 'EMPLOYEE_SENT_HOME',
            entityType: 'User',
            entityId: { in: userIds },
            createdAt: { gte: window.from, lt: window.to },
          },
          select: { entityId: true, createdAt: true },
          orderBy: { createdAt: 'desc' },
          take: Math.min(500, userIds.length * 5),
        }),
        this.prisma.db.shiftReturnRequest.findMany({
          where: {
            factoryId,
            userId: { in: userIds },
            status: 'APPROVED',
            decidedAt: { gte: window.from, lt: window.to },
          },
          select: { userId: true, decidedAt: true },
          orderBy: { decidedAt: 'desc' },
          take: Math.min(500, userIds.length * 5),
        }),
      ]);
      const sessionUsers = new Set(sessions.map((item) => item.userId));
      const assignmentByUser = new Map(assignments.map((item) => [item.userId, item]));
      const lastEndedByUser = new Map<string, Date>();
      for (const item of recentEndedAssignments) if (item.endedAt && !lastEndedByUser.has(item.userId)) lastEndedByUser.set(item.userId, item.endedAt);
      const sentHomeByUser = new Map<string, Date>();
      for (const item of sentHomeRows) if (item.entityId && !sentHomeByUser.has(item.entityId)) sentHomeByUser.set(item.entityId, item.createdAt);
      const returnedByUser = new Map<string, Date>();
      for (const item of approvedReturns) if (item.decidedAt && !returnedByUser.has(item.userId)) returnedByUser.set(item.userId, item.decidedAt);
      for (const userId of userIds) {
        const assignment = assignmentByUser.get(userId) ?? null;
        const sentAt = sentHomeByUser.get(userId);
        const returnedAt = returnedByUser.get(userId);
        const sentHome = Boolean(sentAt && (!returnedAt || returnedAt <= sentAt));
        const lastEndedAt = lastEndedByUser.get(userId);
        const moveIntervalMs = Math.max(0, shiftSettings?.minAssignmentMoveIntervalMinutes ?? 0) * 60_000;
        const moveIntervalBlocked = Boolean(!assignment && lastEndedAt && moveIntervalMs > 0 && Date.now() - lastEndedAt.getTime() < moveIntervalMs);
        const assignmentSummary = assignment ? this.assignmentSearchLabel(assignment) : null;
        result.set(userId, {
          presenceStatus: assignment ? 'На смене' : sentHome ? 'Отправлен домой' : sessionUsers.has(userId) ? 'На смене, свободен' : 'Не отмечен на смене',
          assignmentStatus: assignment ? 'Уже назначен' : sentHome || moveIntervalBlocked ? 'Недоступен' : 'Можно назначить',
          assignmentSummary,
          canAssign: !assignment && !sentHome && !moveIntervalBlocked,
          requiresManualAdd: !assignment && !sentHome && !moveIntervalBlocked && !sessionUsers.has(userId),
          selfConfirmed: null,
          reasonCode: assignment ? 'ALREADY_ASSIGNED' : sentHome ? 'SENT_HOME' : moveIntervalBlocked ? 'MOVE_INTERVAL' : null,
          reason: assignment ? `Сотрудник уже назначен: ${assignmentSummary}` : sentHome ? 'Сотрудник отправлен домой' : moveIntervalBlocked ? 'Сотрудник недавно перемещён. Повторите позже.' : null,
        });
      }
      return result;
    }

    const shiftDate = factoryShiftDate(target);
    const [confirmations, plannedLines, plannedOther] = await Promise.all([
      this.prisma.db.shiftWillBe.findMany({
        where: { factoryId, userId: { in: userIds }, targetShiftDate: shiftDate, shiftType: target.shiftType, status: ShiftWillBeStatus.WILL_BE },
        select: { userId: true },
      }),
      this.prisma.db.plannedLineAssignment.findMany({
        where: { factoryId, userId: { in: userIds }, shiftDate, shiftType: target.shiftType, releasedAt: null },
        include: { line: true, position: true },
      }),
      this.prisma.db.plannedShiftAssignment.findMany({
        where: { factoryId, userId: { in: userIds }, shiftDate, shiftType: target.shiftType, releasedAt: null },
        include: { workArea: true, workAreaPosition: true },
      }),
    ]);
    const confirmedUsers = new Set(confirmations.map((item) => item.userId));
    const lineByUser = new Map(plannedLines.map((item) => [item.userId, item]));
    const otherByUser = new Map(plannedOther.map((item) => [item.userId, item]));
    for (const userId of userIds) {
      const line = lineByUser.get(userId);
      const other = otherByUser.get(userId);
      const assignmentSummary = line
        ? `${line.line.name} · ${line.position.name}`
        : other
          ? other.workArea?.name ?? other.timeRoleName ?? (other.kind === 'WASH' ? 'Мойка' : 'Будущая смена')
          : null;
      const selfConfirmed = confirmedUsers.has(userId);
      result.set(userId, {
        presenceStatus: selfConfirmed ? 'Подтвердил «Я буду»' : 'Не отметил «Я буду»',
        assignmentStatus: assignmentSummary ? 'Уже назначен' : 'Можно назначить',
        assignmentSummary,
        canAssign: !assignmentSummary,
        requiresManualAdd: false,
        selfConfirmed,
        reasonCode: assignmentSummary ? 'ALREADY_ASSIGNED' : null,
        reason: assignmentSummary ? `Сотрудник уже назначен: ${assignmentSummary}` : null,
      });
    }
    return result;
  }

  private assignmentSearchLabel(assignment: any) {
    if (assignment.line) {
      if (!isPilotVisibleLine(assignment.line)) return 'Другое назначение';
      return `${assignment.line.name}${assignment.position?.name ? ` · ${assignment.position.name}` : ''}`;
    }
    if (assignment.workArea) return `${assignment.workArea.name}${assignment.workAreaPosition?.title ? ` · ${assignment.workAreaPosition.title}` : ''}`;
    if (assignment.kind === 'WASH') return 'Мойка';
    return assignment.timeRoleName ?? 'Другое назначение';
  }

  private normalizePersonSearch(value: unknown) {
    return String(value ?? '').trim().toLocaleLowerCase('ru-RU').replace(/ё/g, 'е').replace(/\s+/g, ' ');
  }

  private normalizePhoneSearch(value: unknown) {
    return normalizePhoneSearchDigits(value);
  }

  private phoneIncludes(stored: string, query: string) {
    if (stored.includes(query)) return true;
    if (query.startsWith('8') && stored.includes(`7${query.slice(1)}`)) return true;
    if (query.startsWith('7') && stored.includes(`8${query.slice(1)}`)) return true;
    return false;
  }

  private maskPhone(value: string) {
    const digits = this.normalizePhoneSearch(value);
    if (digits.length < 4) return 'Телефон скрыт';
    return `+7 ••• •••-${digits.slice(-4, -2)}-${digits.slice(-2)}`;
  }

  private roleLabel(role: UserRole) {
    const labels: Partial<Record<UserRole, string>> = {
      [UserRole.WORKER]: 'Работник',
      [UserRole.CONTRACTOR]: 'Наёмный работник',
      [UserRole.MASTER]: 'Мастер',
      [UserRole.MANAGEMENT]: 'Руководство',
      [UserRole.ADMIN]: 'Администратор',
      [UserRole.OKK]: 'ОКК',
      [UserRole.STORE]: 'Склад',
      [UserRole.TECHNOLOG]: 'Технолог',
    };
    return labels[role] ?? 'Сотрудник';
  }

  private canReadPhone(user: UserContext, targetUserId: string, targetRole: UserRole) {
    if (targetUserId === user.userId) return true;
    if (user.isGuest) return false;
    if (user.role === UserRole.WORKER || user.role === UserRole.CONTRACTOR) {
      return ([UserRole.MASTER, UserRole.MANAGEMENT, UserRole.CONTRACTOR_LEAD] as UserRole[]).includes(targetRole);
    }
    return user.isAdmin
      || user.permissions.includes('people.phone.read');
  }

  private canReadNotes(user: UserContext) {
    return user.isAdmin || user.permissions.includes('people.notes.read');
  }

  private availableProfileActions(user: UserContext, target: any, targetRole: UserRole) {
    const actions = ['read'];
    if (this.canReadPhone(user, target.id, targetRole)) actions.push('readPhone');
    if (user.isAdmin || user.permissions.includes('people.skills.manage')) actions.push('manageSkills');
    if (user.isAdmin || user.permissions.includes('people.notes.manage')) actions.push('manageNotes');
    return actions;
  }

  private currentAssignmentWhere(factoryId: string): Prisma.AssignmentWhereInput {
    const window = factoryShiftWindow(factoryShiftTarget());
    return {
      factoryId, endedAt: null,
      OR: [
        { kind: { not: AssignmentKind.LINE } },
        { kind: AssignmentKind.LINE, startedAt: { gte: window.from, lt: window.to } },
      ],
    };
  }

  private visibleCurrentAssignment(target: any) {
    const window = factoryShiftWindow(factoryShiftTarget());
    return (target.assignments ?? []).find((item: any) => {
      if (item.line && !isPilotVisibleLine(item.line)) return false;
      return item.kind !== AssignmentKind.LINE
        || (new Date(item.startedAt) >= window.from && new Date(item.startedAt) < window.to);
    }) ?? null;
  }

  private isOnShift(target: any, assignment: any) {
    // Same factual presence contract as EmployeeService.listPeople; availability alone is not attendance.
    return target.employeeState !== EmployeeState.OFF_SHIFT
      && (Boolean(target.shiftSessions?.[0]) || Boolean(assignment));
  }

  private serializeListPerson(user: UserContext, row: any, profilePhoto: any = null) {
    const assignment = this.visibleCurrentAssignment(row.user);
    const skills = row.user.skills ?? [];
    const canReadPhone = this.canReadPhone(user, row.userId, row.role);
    return {
      userId: row.userId,
      displayName: pilotDisplayName(row.user),
      role: row.role,
      departmentId: row.departmentId,
      departmentName: row.department?.name ?? null,
      employeeState: row.user.employeeState,
      phone: canReadPhone ? row.user.phone : null,
      phoneLabel: canReadPhone ? row.user.phone ?? 'Телефон не указан' : 'Телефон скрыт',
      profilePhoto: this.serializeProfilePhoto(profilePhoto),
      skillsSummary: skills.length ? `${skills.length} навыков` : 'Навыки не указаны',
      onShift: this.isOnShift(row.user, assignment),
      currentAssignment: assignment ? { kind: assignment.kind, lineName: assignment.line?.name ?? null, positionName: assignment.position?.name ?? null } : null,
    };
  }

  private async activeProfilePhoto(factoryId: string, userId: string) {
    return this.prisma.db.attachment.findFirst({
      where: {
        factoryId,
        entityType: AttachmentEntityType.COMMON,
        entityId: userId,
        kind: AttachmentKind.PHOTO,
        operationId: { startsWith: `profile-photo:${factoryId}:${userId}:` },
        deletedAt: null,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  private async profilePhotosForUsers(factoryId: string, userIds: string[]) {
    const grouped = new Map<string, any>();
    if (!userIds.length) return grouped;
    const attachments = await this.prisma.db.attachment.findMany({
      where: {
        factoryId,
        entityType: AttachmentEntityType.COMMON,
        entityId: { in: userIds },
        kind: AttachmentKind.PHOTO,
        operationId: { startsWith: `profile-photo:${factoryId}:` },
        deletedAt: null,
      },
      orderBy: { createdAt: 'desc' },
    });
    for (const attachment of attachments) {
      if (!grouped.has(attachment.entityId)) grouped.set(attachment.entityId, attachment);
    }
    return grouped;
  }

  private serializeProfilePhoto(attachment: any) {
    if (!attachment) return null;
    return {
      id: attachment.id,
      entityType: attachment.entityType,
      entityId: attachment.entityId,
      kind: attachment.kind,
      originalName: this.normalizeOriginalName(attachment.originalName),
      mimeType: attachment.mimeType,
      sizeBytes: attachment.sizeBytes,
      publicUrl: attachment.publicUrl,
      createdAt: attachment.createdAt,
      uploadedById: attachment.uploadedById,
    };
  }

  private async serviceTaskStatus(user: UserContext, targetUserId: string, role: UserRole | string) {
    const serviceRoles = new Set<string>([
      UserRole.TECH_KIPIA,
      UserRole.TECH_HOLOD,
      UserRole.TECH_ELECTRIC,
      UserRole.TECH_MECHANIC,
      UserRole.TECH_SANTECHNIK,
      UserRole.TECHNOLOG,
      UserRole.OKK,
      UserRole.STORE,
    ]);
    if (!serviceRoles.has(String(role))) return null;
    const task: any = await this.prisma.db.task.findFirst({
      where: {
        factoryId: user.selectedFactoryId,
        deletedAt: null,
        status: TaskStatus.IN_PROGRESS,
        OR: [
          { assignedToId: targetUserId },
          { takenById: targetUserId },
          { assignees: { some: { userId: targetUserId, active: true } } },
        ],
      },
      include: {
        line: true,
        departmentRecipients: { include: { department: true } },
        assignees: { where: { active: true }, select: { userId: true, active: true } },
      },
      orderBy: { updatedAt: 'desc' },
    });
    if (!task) {
      return { state: 'FREE', label: 'Свободен' };
    }
    if (!canReadTask(user, task)) {
      return { state: 'ON_TASK', label: 'Занят' };
    }
    return {
      state: 'ON_TASK',
      label: 'Сейчас на заявке',
      taskId: task.id,
      title: task.description ?? 'Заявка',
      lineName: task.line?.name ?? null,
      departments: task.departmentRecipients.map((item: any) => item.department.name),
      sourceRoute: `tasks:${task.id}`,
    };
  }

  private serializeSkill(skill: any) {
    const level = skill.experienceCount >= 10 ? 'Опытный' : skill.experienceCount > 0 ? 'Есть опыт' : 'Нет опыта';
    const color = skill.experienceCount >= 10 ? 'green' : skill.experienceCount > 0 ? 'orange' : 'red';
    return {
      id: skill.id,
      factoryId: skill.factoryId,
      userId: skill.userId,
      lineId: skill.lineId,
      lineName: skill.line?.name ?? null,
      positionId: skill.positionId,
      positionName: skill.position?.name ?? null,
      skillCode: skill.position?.skillCode ?? null,
      skillFamilyKey: skill.skillFamilyKey ?? skill.position?.skillFamilyKey ?? null,
      experienceCount: skill.experienceCount,
      level,
      color,
      isActive: skill.isActive,
      recommended: Boolean(skill.recommendedAt),
      recommendedById: skill.recommendedById,
      recommendedAt: skill.recommendedAt,
      recommendationComment: skill.recommendationComment,
    };
  }

  private cleanSkill(skill: any) {
    return { id: skill.id, experienceCount: skill.experienceCount, isActive: skill.isActive, recommendedAt: skill.recommendedAt, skillFamilyKey: skill.skillFamilyKey };
  }

  private normalizeOriginalName(name: string) {
    const raw = String(name ?? '').trim() || 'файл';
    if (!/[ÃÐÑ][\u0080-\u00bf]/.test(raw)) return raw;
    const decoded = Buffer.from(raw, 'latin1').toString('utf8');
    return decoded.includes('\uFFFD') ? raw : decoded;
  }

  private requiredText(value: unknown, message: string) {
    const text = String(value ?? '').trim();
    if (!text) throw new ConflictError(message);
    return text;
  }

  private nonNegativeInt(value: unknown, message: string) {
    const number = Number(value);
    if (!Number.isInteger(number) || number < 0) throw new ConflictError(message);
    return number;
  }

  private async writeDenied(user: UserContext, reason: string, entityId?: string) {
    try {
      await this.auditService.write({
        userId: user.userId,
        factoryId: user.selectedFactoryId || null,
        action: 'ACCESS_DENIED',
        entityType: 'People',
        entityId: entityId ?? user.userId,
        details: { reason, role: user.role, departmentId: user.departmentId },
      });
    } catch {
      // Denial result must not depend on audit availability.
    }
  }
}

