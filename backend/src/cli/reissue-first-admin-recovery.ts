import { PrismaClient } from '@prisma/client';
import { closeSync, existsSync, lstatSync, openSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute } from 'node:path';
import { spawnSync } from 'node:child_process';
import { generateRecoveryCredential, assertRecoveryCredentialPolicy } from '../common/recovery-credential';
import { reissueFirstAdminRecovery } from '../common/first-admin-bootstrap';

const FLAGS = new Set(['--database-name', '--server-address', '--server-port', '--factory-code', '--admin-phone', '--credential-file', '--credential-ttl-minutes']);

function argsMap(args: string[]) {
  const parsed = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    if (!FLAGS.has(flag) || !value || value.startsWith('--') || parsed.has(flag)) throw new Error('FIRST_ADMIN_RECOVERY_REFUSED: invalid or duplicate command option');
    parsed.set(flag, value);
  }
  return parsed;
}

function required(args: Map<string, string>, flag: string) {
  const value = args.get(flag);
  if (!value) throw new Error(`FIRST_ADMIN_RECOVERY_REFUSED: missing ${flag}`);
  return value;
}

function assertPrivateWindowsAcl(path: string) {
  if (process.platform !== 'win32') return;
  const script = [
    '$a=Get-Acl -LiteralPath $env:ZAVOD_RECOVERY_ACL_PATH',
    '$me=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value',
    '$allowed=@($me,"S-1-5-18","S-1-5-32-544")',
    'foreach($entry in $a.Access){',
    '  if($entry.AccessControlType -ne "Allow"){continue}',
    '  try{$sid=$entry.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value}catch{exit 1}',
    '  if($allowed -notcontains $sid){exit 1}',
    '}',
    'exit 0',
  ].join(';');
  const checked = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    env: { ...process.env, ZAVOD_RECOVERY_ACL_PATH: path }, windowsHide: true, encoding: 'utf8',
  });
  if (checked.status !== 0) throw new Error('FIRST_ADMIN_RECOVERY_REFUSED: credential ACL is not private');
}

function protectedCredential(path: string) {
  if (!isAbsolute(path)) throw new Error('FIRST_ADMIN_RECOVERY_REFUSED: credential file path must be absolute');
  const parent = statSync(dirname(path));
  if (!parent.isDirectory() || (process.platform !== 'win32' && (parent.mode & 0o077) !== 0)) {
    throw new Error('FIRST_ADMIN_RECOVERY_REFUSED: credential directory must be private');
  }
  assertPrivateWindowsAcl(dirname(path));
  if (existsSync(path)) {
    const stat = lstatSync(path);
    if (!stat.isFile() || (process.platform !== 'win32' && (stat.mode & 0o077) !== 0)) {
      throw new Error('FIRST_ADMIN_RECOVERY_REFUSED: credential file must be private and regular');
    }
    assertPrivateWindowsAcl(path);
    const credential = readFileSync(path, 'utf8').replace(/\r?\n$/u, '');
    assertRecoveryCredentialPolicy(credential);
    return credential;
  }
  const credential = generateRecoveryCredential();
  // Exclusive creation keeps the same protected value available after a lost CLI response.
  const descriptor = openSync(path, 'wx', 0o600);
  try { writeFileSync(descriptor, `${credential}\n`, 'utf8'); } finally { closeSync(descriptor); }
  assertPrivateWindowsAcl(path);
  return credential;
}

function safeError(error: unknown) {
  const message = error instanceof Error ? error.message : 'Unknown error';
  return message.replace(/postgres(?:ql)?:\/\/[^\s]+/giu, '[DATABASE_URL hidden]');
}

async function main() {
  const urlValue = process.env.DATABASE_URL;
  if (!urlValue) throw new Error('FIRST_ADMIN_RECOVERY_REFUSED: explicit DATABASE_URL required; .env is not loaded');
  const args = argsMap(process.argv.slice(2));
  const url = new URL(urlValue);
  const databaseName = required(args, '--database-name');
  const serverAddress = required(args, '--server-address');
  const serverPort = Number(required(args, '--server-port'));
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || url.pathname.slice(1) !== databaseName
    || url.hostname !== serverAddress || Number(url.port || 5432) !== serverPort) {
    throw new Error('FIRST_ADMIN_RECOVERY_REFUSED: DATABASE_URL and explicit target do not match');
  }
  const prisma = new PrismaClient();
  try {
    const [identity] = await prisma.$queryRaw<Array<{ database_name: string; server_address: string | null; server_port: number | null }>>`
      SELECT current_database() AS database_name, host(inet_server_addr()) AS server_address, inet_server_port() AS server_port
    `;
    if (identity?.database_name !== databaseName || identity.server_address !== serverAddress || Number(identity.server_port) !== serverPort) {
      throw new Error('FIRST_ADMIN_RECOVERY_REFUSED: connected database identity mismatch');
    }
    const credential = protectedCredential(required(args, '--credential-file'));
    const ttlRaw = args.get('--credential-ttl-minutes');
    const result = await reissueFirstAdminRecovery(prisma, {
      databaseName, serverAddress, serverPort,
      factoryCode: required(args, '--factory-code'), adminPhone: required(args, '--admin-phone'),
      recoveryCredential: credential, credentialTtlMinutes: ttlRaw ? Number(ttlRaw) : undefined,
    });
    process.stdout.write(`FIRST_ADMIN_RECOVERY=${result.status}\nCHANGED=${result.changed ? 'YES' : 'NO'}\nADMIN_PHONE=${result.maskedPhone}\nCREDENTIAL_EXPIRES_AT=${result.credentialExpiresAt.toISOString()}\n`);
    if (!result.changed) process.exitCode = 3;
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  process.stderr.write(`FIRST_ADMIN_RECOVERY=FAILED\n${safeError(error)}\n`);
  process.exitCode = 1;
});
