import { PrismaClient } from '@prisma/client';
import { checkRuntimeReadiness } from '../common/runtime-readiness';

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL должен быть задан для выбранной БД.');
  const db = new PrismaClient();
  try {
    const state = await checkRuntimeReadiness(db);
    process.stdout.write(`RUNTIME_READINESS=${state.code}\n`);
    if (!state.ready) process.exitCode = state.code === 'FIRST_ADMIN_REQUIRED' ? 3 : 2;
  } finally {
    await db.$disconnect();
  }
}

main().catch(() => {
  process.stderr.write('RUNTIME_READINESS=DB_UNAVAILABLE\n');
  process.exitCode = 2;
});
