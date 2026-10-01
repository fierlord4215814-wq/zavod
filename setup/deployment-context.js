'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const EXACT_FILES = [
  '.dockerignore',
  'package.json',
  'package-lock.json',
  'backend/Dockerfile.production',
  'backend/package.json',
  'backend/tsconfig.json',
  'backend/tsconfig.build.json',
  'backend/prisma/schema.prisma',
  'backend/prisma/system-foundation.cjs',
  'backend/prisma/migrations/migration_lock.toml',
  'frontend/Dockerfile.production',
  'frontend/nginx.production.conf',
  'frontend/package.json',
  'frontend/tsconfig.json',
  'frontend/vite.config.ts',
  'frontend/index.html',
];
const SOURCE_AREAS = [
  ['backend/src', new Set(['.ts'])],
  ['frontend/src', new Set(['.ts', '.tsx', '.css'])],
  ['frontend/public', new Set(['.js', '.png', '.svg', '.html', '.webmanifest', '.ico', '.woff', '.woff2'])],
];
const MIGRATION_NAME = /^\d{14}_[a-z0-9_]+$/;

function canonicalBuildFiles(files) {
  return [...new Set(files.map((relative) => {
    const normalized = relative.replace(/\\/g, '/');
    if (normalized.startsWith('/') || /^[A-Za-z]:\//.test(normalized)
      || normalized.split('/').some((part) => !part || part === '.' || part === '..')) {
      throw new Error(`Небезопасный относительный build path: ${relative}`);
    }
    return normalized;
  }))].sort();
}

function copyRegularFile(sourceRoot, destinationRoot, relativePath) {
  const source = path.join(sourceRoot, relativePath);
  const stat = fs.lstatSync(source);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`Небезопасный build source: ${relativePath}`);
  const destination = path.join(destinationRoot, relativePath);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination, fs.constants.COPYFILE_EXCL);
  return relativePath.replace(/\\/g, '/');
}

function walkAllowed(sourceRoot, relativeDir, extensions, collected) {
  const absolute = path.join(sourceRoot, relativeDir);
  const dir = fs.lstatSync(absolute);
  if (!dir.isDirectory() || dir.isSymbolicLink()) throw new Error(`Небезопасный build directory: ${relativeDir}`);
  for (const entry of fs.readdirSync(absolute, { withFileTypes: true })) {
    const relative = path.join(relativeDir, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Ссылка в build source запрещена: ${relative}`);
    if (entry.isDirectory()) {
      if (entry.name.startsWith('.') || ['node_modules', 'dist', 'coverage', 'test-results', 'screenshots', 'traces'].includes(entry.name)) continue;
      walkAllowed(sourceRoot, relative, extensions, collected);
    } else if (entry.isFile() && extensions.has(path.extname(entry.name).toLowerCase())
      && !/(?:^|[.-])(spec|test)(?:[.-]|$)/i.test(entry.name)) {
      collected.push(relative);
    }
  }
}

function collectBuildFiles(sourceRoot) {
  const files = [...EXACT_FILES];
  for (const [dir, extensions] of SOURCE_AREAS) walkAllowed(sourceRoot, dir, extensions, files);
  const migrationRoot = path.join(sourceRoot, 'backend', 'prisma', 'migrations');
  for (const entry of fs.readdirSync(migrationRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || !MIGRATION_NAME.test(entry.name)) continue;
    files.push(path.join('backend', 'prisma', 'migrations', entry.name, 'migration.sql'));
  }
  return canonicalBuildFiles(files);
}

function createBuildContext(sourceRoot) {
  const destination = fs.mkdtempSync(path.join(os.tmpdir(), 'zavod-build-context-'));
  try {
    const files = collectBuildFiles(sourceRoot);
    for (const relative of files) copyRegularFile(sourceRoot, destination, relative);
    return { path: destination, files };
  } catch (error) {
    removeBuildContext(destination);
    throw error;
  }
}

function removeBuildContext(destination) {
  const resolved = path.resolve(destination);
  const parent = path.dirname(resolved);
  if (parent !== path.resolve(os.tmpdir()) || !path.basename(resolved).startsWith('zavod-build-context-')) {
    throw new Error('Отказ удалить чужой build context.');
  }
  fs.rmSync(resolved, { recursive: true, force: false });
}

module.exports = { canonicalBuildFiles, collectBuildFiles, createBuildContext, removeBuildContext };
