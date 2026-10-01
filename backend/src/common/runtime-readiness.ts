import { Prisma, PrismaClient, UserRole } from '@prisma/client';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SYSTEM_FOUNDATION_ID } from './system-foundation';

export type RuntimeReadinessCode =
  | 'READY'
  | 'DB_UNAVAILABLE'
  | 'MIGRATIONS_INCOMPLETE'
  | 'FOUNDATION_REQUIRED'
  | 'FIRST_ADMIN_REQUIRED';

export type RuntimeReadiness = { ready: boolean; code: RuntimeReadinessCode };

type MigrationRecord = {
  migration_name: string;
  checksum: string;
  finished_at: Date | null;
  rolled_back_at: Date | null;
};

const migrationsRoot = join(__dirname, '..', '..', 'prisma', 'migrations');
const migrationFiles = readdirSync(migrationsRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && /^\d{14}_[a-z0-9_]+$/.test(entry.name))
  .map((entry) => ({
    name: entry.name,
    checksum: createHash('sha256').update(readFileSync(join(migrationsRoot, entry.name, 'migration.sql'))).digest('hex'),
  }));

if (!migrationFiles.length) throw new Error('Список миграций приложения пуст.');

export async function checkRuntimeReadiness(db: PrismaClient): Promise<RuntimeReadiness> {
  try {
    return await db.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('SET LOCAL statement_timeout = 2000');
      const records = await tx.$queryRaw<MigrationRecord[]>`
        SELECT migration_name, checksum, finished_at, rolled_back_at FROM "_prisma_migrations"
      `;
      const completed = new Map<string, string>();
      for (const record of records) {
        if (!record.finished_at && !record.rolled_back_at) return { ready: false, code: 'MIGRATIONS_INCOMPLETE' };
        if (record.finished_at && !record.rolled_back_at) completed.set(record.migration_name, record.checksum);
      }
      if (completed.size !== migrationFiles.length || migrationFiles.some((file) => completed.get(file.name) !== file.checksum)) {
        return { ready: false, code: 'MIGRATIONS_INCOMPLETE' };
      }

      const foundation = await tx.systemFoundationState.findUnique({ where: { id: SYSTEM_FOUNDATION_ID } });
      if (!foundation || foundation.version !== 1) return { ready: false, code: 'FOUNDATION_REQUIRED' };

      const administrators = await tx.userFactoryAccess.count({
        where: {
          role: UserRole.ADMIN,
          isActive: true,
          isGuest: false,
          user: { blockedAt: null, deletedAt: null },
          factory: { isActive: true, deletedAt: null },
        },
      });
      return administrators > 0
        ? { ready: true, code: 'READY' }
        : { ready: false, code: 'FIRST_ADMIN_REQUIRED' };
    }, { maxWait: 2000, timeout: 4000, isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
  } catch (error) {
    const prismaCode = typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : '';
    const metadata = typeof error === 'object' && error !== null && 'meta' in error ? error.meta : null;
    const sqlState = metadata && typeof metadata === 'object' && 'code' in metadata ? String(metadata.code) : '';
    if (prismaCode === 'P2021' || prismaCode === 'P2022' || sqlState === '42P01' || sqlState === '42703') {
      return { ready: false, code: 'MIGRATIONS_INCOMPLETE' };
    }
    return { ready: false, code: 'DB_UNAVAILABLE' };
  }
}
