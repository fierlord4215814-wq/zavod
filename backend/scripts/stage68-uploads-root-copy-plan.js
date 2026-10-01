const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

function usage() {
  return [
    'Stage68 uploads root copy-plan',
    '',
    'Dry-run по умолчанию:',
    '  node scripts/stage68-uploads-root-copy-plan.js --source C:\\Users\\79164\\Documents\\work\\backend\\uploads --target C:\\Users\\79164\\Documents\\work\\uploads',
    '',
    'Apply только после отдельного разрешения:',
    '  node scripts/stage68-uploads-root-copy-plan.js --source <oldRoot> --target <canonicalRoot> --apply',
  ].join('\n');
}

function parseArgs(argv) {
  const result = { source: null, target: null, apply: false, skipDb: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--source') result.source = argv[++index] ?? null;
    else if (arg.startsWith('--source=')) result.source = arg.slice('--source='.length);
    else if (arg === '--target') result.target = argv[++index] ?? null;
    else if (arg.startsWith('--target=')) result.target = arg.slice('--target='.length);
    else if (arg === '--apply') result.apply = true;
    else if (arg === '--skip-db') result.skipDb = true;
    else if (arg === '--help' || arg === '-h') {
      console.log(usage());
      process.exit(0);
    } else {
      throw new Error(`Неизвестный аргумент: ${arg}\n\n${usage()}`);
    }
  }
  if (!result.source || !result.target) throw new Error(`Укажите --source и --target.\n\n${usage()}`);
  result.source = path.resolve(result.source);
  result.target = path.resolve(result.target);
  if (result.source === result.target) throw new Error('Source и target не должны совпадать.');
  if (isInside(result.source, result.target)) throw new Error('Target не должен находиться внутри source.');
  return result;
}

function isInside(parent, child) {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

async function listFilesRecursive(dir) {
  if (!fs.existsSync(dir)) return [];
  const result = [];
  async function walk(current) {
    const entries = await fsp.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) await walk(fullPath);
      else if (entry.isFile()) result.push(fullPath);
    }
  }
  await walk(dir);
  return result;
}

async function sha256(file) {
  const hash = crypto.createHash('sha256');
  hash.update(await fsp.readFile(file));
  return hash.digest('hex');
}

async function fileIndex(root) {
  const files = await listFilesRecursive(root);
  const index = new Map();
  let totalSizeBytes = 0;
  for (const file of files) {
    const stat = await fsp.stat(file);
    totalSizeBytes += stat.size;
    const relative = path.relative(root, file).replace(/\\/g, '/');
    index.set(relative, { file, sizeBytes: stat.size });
  }
  return { root, files, index, fileCount: files.length, totalSizeBytes };
}

function loadBackendEnv() {
  const backendDir = path.resolve(__dirname, '..');
  const envPath = path.join(backendDir, '.env');
  if (!fs.existsSync(envPath)) return;
  for (const rawLine of fs.readFileSync(envPath, 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match || process.env[match[1]]) continue;
    process.env[match[1]] = match[2].trim().replace(/^['"]|['"]$/g, '');
  }
}

async function activeAttachmentPaths(skipDb) {
  if (skipDb) return { paths: new Set(), count: 0, skipped: true };
  loadBackendEnv();
  try {
    const { PrismaClient } = require('@prisma/client');
    const prisma = new PrismaClient();
    try {
      const attachments = await prisma.attachment.findMany({
        where: { deletedAt: null },
        select: { storagePath: true },
      });
      return {
        paths: new Set(attachments.map((item) => String(item.storagePath ?? '').replace(/\\/g, '/'))),
        count: attachments.length,
        skipped: false,
      };
    } finally {
      await prisma.$disconnect();
    }
  } catch (error) {
    return { paths: new Set(), count: 0, skipped: true, warning: 'Attachment records не прочитаны; copy-plan выполнен без DB orphan матрицы.' };
  }
}

function maskRelative(relativePath) {
  const parts = String(relativePath || '').split('/');
  return `${parts[0] || '(root)'}/...`;
}

async function buildPlan(sourceRoot, targetRoot, options = {}) {
  const [source, target, attachmentRefs] = await Promise.all([
    fileIndex(sourceRoot),
    fileIndex(targetRoot),
    activeAttachmentPaths(Boolean(options.skipDb)),
  ]);
  const warnings = [];
  if (attachmentRefs.warning) warnings.push(attachmentRefs.warning);
  const copy = [];
  const alreadySame = [];
  const conflicts = [];
  const sourceExtra = [];
  let referencedCopyable = 0;
  let referencedAlreadySame = 0;
  let referencedConflicts = 0;

  for (const [relativePath, sourceFile] of source.index.entries()) {
    const targetFile = target.index.get(relativePath);
    const isReferenced = attachmentRefs.paths.has(relativePath);
    if (!isReferenced && !attachmentRefs.skipped) sourceExtra.push(relativePath);
    if (!targetFile) {
      copy.push(relativePath);
      if (isReferenced) referencedCopyable += 1;
      continue;
    }
    const [sourceHash, targetHash] = await Promise.all([sha256(sourceFile.file), sha256(targetFile.file)]);
    if (sourceHash === targetHash) {
      alreadySame.push(relativePath);
      if (isReferenced) referencedAlreadySame += 1;
    } else {
      conflicts.push(relativePath);
      if (isReferenced) referencedConflicts += 1;
    }
  }

  return {
    mode: 'dry-run',
    source: { root: sourceRoot, fileCount: source.fileCount, totalSizeBytes: source.totalSizeBytes },
    target: { root: targetRoot, fileCount: target.fileCount, totalSizeBytes: target.totalSizeBytes },
    attachmentRefs: { activeCount: attachmentRefs.count, skipped: attachmentRefs.skipped },
    summary: {
      copyableMissingInTarget: copy.length,
      alreadyExistsSameChecksum: alreadySame.length,
      conflictsDifferentChecksum: conflicts.length,
      sourceOrphanExtraFiles: sourceExtra.length,
      referencedCopyable,
      referencedAlreadySame,
      referencedConflicts,
    },
    maskedExamples: {
      copyable: copy.slice(0, 5).map(maskRelative),
      conflicts: conflicts.slice(0, 5).map(maskRelative),
      sourceOrphans: sourceExtra.slice(0, 5).map(maskRelative),
    },
    internal: { copy, conflicts },
    warnings,
  };
}

async function applyPlan(plan) {
  if (plan.internal.conflicts.length > 0) {
    throw new Error(`Есть conflicts с разным checksum: ${plan.internal.conflicts.length}. Apply остановлен.`);
  }
  let copied = 0;
  for (const relativePath of plan.internal.copy) {
    const sourcePath = path.resolve(plan.source.root, relativePath);
    const targetPath = path.resolve(plan.target.root, relativePath);
    if (!sourcePath.startsWith(path.resolve(plan.source.root)) || !targetPath.startsWith(path.resolve(plan.target.root))) {
      throw new Error('Недопустимый относительный путь в copy-plan.');
    }
    if (fs.existsSync(targetPath)) continue;
    await fsp.mkdir(path.dirname(targetPath), { recursive: true });
    await fsp.copyFile(sourcePath, targetPath);
    copied += 1;
  }
  return copied;
}

function publicPlan(plan, mode, copied = 0) {
  const { internal: _internal, ...safe } = plan;
  return { ok: true, mode, copied, ...safe };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const plan = await buildPlan(args.source, args.target, { skipDb: args.skipDb });
  if (!args.apply) {
    console.log(JSON.stringify(publicPlan(plan, 'dry-run'), null, 2));
    return;
  }
  const copied = await applyPlan(plan);
  console.log(JSON.stringify(publicPlan(plan, 'apply', copied), null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }, null, 2));
  process.exit(1);
});
