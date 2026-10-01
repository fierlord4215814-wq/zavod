import { PrismaClient } from '@prisma/client';
import { readFileSync, statSync } from 'node:fs';
import { bootstrapFirstAdmin, type FirstAdminBootstrapTestHooks } from '../common/first-admin-bootstrap';

const VALUE_FLAGS = new Set([
  '--factory-name',
  '--factory-code',
  '--admin-phone',
  '--admin-last-name',
  '--admin-first-name',
  '--admin-middle-name',
  '--credential-file',
  '--credential-ttl-minutes',
]);
const BOOLEAN_FLAGS = new Set(['--credential-stdin']);

function parseArgs(args: string[]) {
  const parsed = new Map<string, string | true>();
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    if (BOOLEAN_FLAGS.has(flag)) {
      parsed.set(flag, true);
      continue;
    }
    if (!VALUE_FLAGS.has(flag)) throw new Error(`Неизвестный параметр: ${flag}`);
    const value = args[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`Не указано значение параметра ${flag}.`);
    parsed.set(flag, value);
    index += 1;
  }
  return parsed;
}

function required(args: Map<string, string | true>, flag: string) {
  const value = args.get(flag);
  if (typeof value !== 'string' || !value.trim()) throw new Error(`Обязательный параметр не указан: ${flag}`);
  return value;
}

function withoutSingleTrailingNewline(value: string) {
  return value.replace(/\r?\n$/u, '');
}

function readCredential(args: Map<string, string | true>) {
  const stdin = args.get('--credential-stdin') === true;
  const file = args.get('--credential-file');
  if (stdin === (typeof file === 'string')) {
    throw new Error('Выберите ровно один защищённый источник: --credential-stdin или --credential-file <path>.');
  }
  if (stdin) return withoutSingleTrailingNewline(readFileSync(0, 'utf8'));

  const filePath = String(file);
  const stat = statSync(filePath);
  if (!stat.isFile()) throw new Error('Источник временного кода должен быть обычным файлом.');
  if (process.platform !== 'win32' && (stat.mode & 0o077) !== 0) {
    throw new Error('Файл временного кода доступен группе или другим пользователям. Требуется chmod 600.');
  }
  return withoutSingleTrailingNewline(readFileSync(filePath, 'utf8'));
}

function safeError(error: unknown) {
  const message = error instanceof Error ? error.message : 'Неизвестная ошибка';
  return message
    .replace(/postgres(?:ql)?:\/\/[^\s]+/giu, '[DATABASE_URL скрыт]')
    .replace(/(password|secret|credential)=([^\s]+)/giu, '$1=[скрыто]');
}

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL должен быть явно задан для выбранной целевой базы. Файл .env команда не загружает.');
  }
  const args = parseArgs(process.argv.slice(2));
  const recoveryCredential = readCredential(args);
  const ttlRaw = args.get('--credential-ttl-minutes');
  const credentialTtlMinutes = typeof ttlRaw === 'string' ? Number(ttlRaw) : undefined;

  const testHooks: FirstAdminBootstrapTestHooks = {};
  if (process.env.NODE_ENV === 'test' && process.env.VPS_PREP_ALLOW_FAILPOINTS === 'true') {
    const failAfter = process.env.VPS_PREP_TEST_FAIL_AFTER;
    if (failAfter === 'factory' || failAfter === 'user' || failAfter === 'access') testHooks.failAfter = failAfter;
  }

  const prisma = new PrismaClient();
  try {
    const result = await bootstrapFirstAdmin(prisma, {
      factoryName: required(args, '--factory-name'),
      factoryCode: required(args, '--factory-code'),
      adminPhone: required(args, '--admin-phone'),
      adminLastName: required(args, '--admin-last-name'),
      adminFirstName: required(args, '--admin-first-name'),
      adminMiddleName: typeof args.get('--admin-middle-name') === 'string' ? String(args.get('--admin-middle-name')) : null,
      recoveryCredential,
      credentialTtlMinutes,
    }, testHooks);

    process.stdout.write([
      `FIRST_ADMIN_BOOTSTRAP=${result.status}`,
      `CHANGED=${result.changed ? 'YES' : 'NO'}`,
      `ADMIN_PHONE=${result.maskedPhone}`,
      `CREDENTIAL_EXPIRES_AT=${result.credentialExpiresAt.toISOString()}`,
      '',
    ].join('\n'));
    if (result.status === 'ALREADY_COMPLETED') process.exitCode = 3;
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  process.stderr.write(`FIRST_ADMIN_BOOTSTRAP=FAILED\n${safeError(error)}\n`);
  process.exitCode = 1;
});
