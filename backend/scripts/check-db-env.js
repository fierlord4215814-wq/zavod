const fs = require('fs');
const net = require('net');
const path = require('path');

const envPath = path.resolve(__dirname, '..', '.env');

function parseEnv(content) {
  const result = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    result[key] = rawValue.replace(/^['"]|['"]$/g, '');
  }
  return result;
}

function maskUrl(url) {
  try {
    const parsed = new URL(url);
    if (parsed.username) parsed.username = '***';
    if (parsed.password) parsed.password = '***';
    return parsed.toString();
  } catch {
    return '<invalid url>';
  }
}

function checkTcp(host, port, timeoutMs = 1500) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port: Number(port), timeout: timeoutMs });
    const done = (ok) => {
      socket.destroy();
      resolve(ok);
    };
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
  });
}

async function main() {
  console.log('DB/env doctor');
  console.log('-------------');

  if (!fs.existsSync(envPath)) {
    console.log('backend/.env: не найден');
    console.log('Следующий шаг: скопируйте backend/.env.example в backend/.env и заполните DATABASE_URL.');
    process.exit(1);
  }

  console.log('backend/.env: найден');
  const env = parseEnv(fs.readFileSync(envPath, 'utf8'));
  const databaseUrl = env.DATABASE_URL;

  if (!databaseUrl) {
    console.log('DATABASE_URL: не найден');
    console.log('Следующий шаг: скопируйте backend/.env.example в backend/.env и заполните DATABASE_URL.');
    process.exit(1);
  }

  console.log('DATABASE_URL: найден');
  console.log(`Safe URL: ${maskUrl(databaseUrl)}`);

  let parsed;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    console.log('URL: некорректный');
    console.log('Следующий шаг: проверьте формат DATABASE_URL. Нужен postgresql:// или postgres:// URL.');
    process.exit(1);
  }

  if (!['postgresql:', 'postgres:'].includes(parsed.protocol)) {
    console.log(`Protocol: ${parsed.protocol || '<none>'}`);
    console.log('Следующий шаг: DATABASE_URL должен начинаться с postgresql:// или postgres://.');
    process.exit(1);
  }

  const host = parsed.hostname;
  const port = parsed.port || '5432';
  const database = parsed.pathname.replace(/^\//, '') || '<not specified>';

  console.log(`Host: ${host}`);
  console.log(`Port: ${port}`);
  console.log(`Database: ${database}`);

  const tcpOk = await checkTcp(host, port);
  console.log(`TCP: ${tcpOk ? 'доступен' : 'недоступен'}`);
  if (!tcpOk) {
    console.log('Следующий шаг: запустите PostgreSQL или проверьте host/port в DATABASE_URL.');
    process.exit(1);
  }

  console.log('Следующий шаг: выполните npm run prisma:migrate:status --workspace backend.');
}

main().catch((error) => {
  console.error('Doctor failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
