'use strict';

const fs = require('node:fs');
const path = require('node:path');

const MARKER = '.zavod-postgres-18-storage.json';
// The image runs PostgreSQL as uid 70 after initializing PGDATA. Its bind-mounted
// parent must be traversable, while listing remains restricted to the setup owner.
const DB_PARENT_MODE = 0o711;

function assertNoOverlap(paths) {
  const resolved = paths.map(([name, value]) => [name, path.resolve(value)]);
  for (let i = 0; i < resolved.length; i += 1) {
    for (let j = i + 1; j < resolved.length; j += 1) {
      const [leftName, left] = resolved[i];
      const [rightName, right] = resolved[j];
      const relative = path.relative(left, right);
      if (!relative || (!relative.startsWith('..') && !path.isAbsolute(relative))) {
        throw new Error(`Постоянные пути ${leftName} и ${rightName} пересекаются.`);
      }
      const reverse = path.relative(right, left);
      if (!reverse || (!reverse.startsWith('..') && !path.isAbsolute(reverse))) {
        throw new Error(`Постоянные пути ${leftName} и ${rightName} пересекаются.`);
      }
    }
  }
}

function assertStoragePaths(config) {
  assertNoOverlap([
    ['DB', config.dbDataDir],
    ['uploads', config.uploadsDir],
    ['backups', config.backupsDir],
    ['error reports', config.errorReportsExportPath],
    ['logs', config.logsDir],
  ]);
}

function assertOutsideProject(config, projectRoot) {
  const root = path.resolve(projectRoot);
  for (const [name, value] of [
    ['DB', config.dbDataDir], ['uploads', config.uploadsDir], ['backups', config.backupsDir],
    ['error reports', config.errorReportsExportPath], ['logs', config.logsDir],
  ]) {
    const target = path.resolve(value);
    const relative = path.relative(root, target);
    const reverse = path.relative(target, root);
    if (!relative || (!relative.startsWith('..') && !path.isAbsolute(relative))
      || !reverse || (!reverse.startsWith('..') && !path.isAbsolute(reverse))) {
      throw new Error(`Путь ${name} не должен пересекаться с каталогом исходников приложения.`);
    }
  }
}

function inspectDbStorage(dbDataDir) {
  const target = path.resolve(dbDataDir);
  if (!fs.existsSync(target)) return { state: 'NEW', target };
  const stat = fs.lstatSync(target);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Путь данных PostgreSQL должен быть обычным каталогом.');
  const markerPath = path.join(target, MARKER);
  if (!fs.existsSync(markerPath)) throw new Error('Каталог PostgreSQL уже существует без маркера этой установки. Требуется отдельное решение оператора; автоматическая инициализация запрещена.');
  const markerStat = fs.lstatSync(markerPath);
  if (!markerStat.isFile() || markerStat.isSymbolicLink()) throw new Error('Маркер хранилища PostgreSQL недопустим.');
  let marker;
  try { marker = JSON.parse(fs.readFileSync(markerPath, 'utf8')); } catch { throw new Error('Маркер хранилища PostgreSQL повреждён.'); }
  if (marker.contract !== 'postgres-18-parent-mount-v1' || marker.target !== '/var/lib/postgresql' || marker.hostPath !== target) {
    throw new Error('Каталог PostgreSQL имеет несовместимый контракт хранения.');
  }
  const unexpected = fs.readdirSync(target).filter((entry) => entry !== MARKER && entry !== '18');
  if (unexpected.length) throw new Error('Каталог PostgreSQL содержит посторонние или прежние данные. Автоматическое подключение запрещено.');
  const versionRoot = path.join(target, '18');
  if (fs.existsSync(versionRoot)) {
    const versionStat = fs.lstatSync(versionRoot);
    if (!versionStat.isDirectory() || versionStat.isSymbolicLink()) throw new Error('Некорректная структура PostgreSQL 18.');
    if (fs.readdirSync(versionRoot).some((entry) => entry !== 'docker')) throw new Error('Некорректная структура PostgreSQL 18.');
    const pgdata = path.join(versionRoot, 'docker');
    if (fs.existsSync(pgdata)) {
      const pgdataStat = fs.lstatSync(pgdata);
      if (!pgdataStat.isDirectory() || pgdataStat.isSymbolicLink()) throw new Error('Некорректный PGDATA PostgreSQL 18.');
      const pgVersion = path.join(pgdata, 'PG_VERSION');
      if (fs.existsSync(pgVersion) && fs.readFileSync(pgVersion, 'utf8').trim() !== '18') {
        throw new Error('PGDATA принадлежит другой major-версии PostgreSQL.');
      }
    }
  }
  if (process.platform !== 'win32' && ((stat.mode & 0o022) !== 0 || (stat.mode & 0o700) !== 0o700)) {
    throw new Error('Каталог PostgreSQL имеет небезопасные права владельца или записи.');
  }
  return { state: 'OWNED', target, needsTraverse: process.platform !== 'win32' && (stat.mode & 0o777) !== DB_PARENT_MODE };
}

function prepareDbStorage(dbDataDir) {
  const inspected = inspectDbStorage(dbDataDir);
  if (inspected.state === 'OWNED') {
    if (inspected.needsTraverse) fs.chmodSync(inspected.target, DB_PARENT_MODE);
    return { state: 'OWNED', target: inspected.target };
  }
  fs.mkdirSync(path.dirname(inspected.target), { recursive: true, mode: 0o700 });
  fs.mkdirSync(inspected.target, { recursive: false, mode: DB_PARENT_MODE });
  if (process.platform !== 'win32') fs.chmodSync(inspected.target, DB_PARENT_MODE);
  fs.writeFileSync(path.join(inspected.target, MARKER), `${JSON.stringify({
    contract: 'postgres-18-parent-mount-v1',
    target: '/var/lib/postgresql',
    pgdata: '/var/lib/postgresql/18/docker',
    hostPath: inspected.target,
    createdAt: new Date().toISOString(),
  }, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  return { state: 'CREATED', target: inspected.target };
}

module.exports = { MARKER, assertNoOverlap, assertStoragePaths, assertOutsideProject, inspectDbStorage, prepareDbStorage };
