import { PrismaClient } from '@prisma/client';
import { applySystemFoundation } from '../common/system-foundation';

function safeErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : 'Неизвестная ошибка';
  return message
    .replace(/postgres(?:ql)?:\/\/[^\s]+/gi, '[DATABASE_URL_REDACTED]')
    .replace(/(password|secret|credential)=([^\s&]+)/gi, '$1=[REDACTED]');
}

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL должен быть явно задан для выбранной целевой базы. Файл .env команда не загружает.');
  }
  const prisma = new PrismaClient();
  try {
    const result = await applySystemFoundation(prisma);
    process.stdout.write([
      `SYSTEM_FOUNDATION=${result.state}`,
      `CATALOG_VERSION=${result.catalogVersion}`,
      `PERMISSIONS_CREATED=${result.permissionsCreated}`,
      `ROLE_GRANTS_CREATED=${result.roleGrantsCreated}`,
      '',
    ].join('\n'));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  process.stderr.write(`SYSTEM_FOUNDATION=FAILED\n${safeErrorMessage(error)}\n`);
  process.exitCode = 1;
});
