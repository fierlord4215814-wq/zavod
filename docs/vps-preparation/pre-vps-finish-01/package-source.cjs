'use strict';

// Source-only packaging. No Docker, application, database or runtime config is read.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { collectBuildFiles } = require('../../../setup/deployment-context');

const root = path.resolve(__dirname, '../../..');
const hostFiles = [
  'docker-compose.production.yml',
  'frontend/nginx.https.example.conf',
  'setup/zavod-setup.js',
  'setup/deployment-context.js',
  'setup/storage-contract.js',
  'setup/wizard.html',
  'setup/restore.html',
  'setup/assets/zavod-shortcut.png',
  'setup/assets/zavod-shortcut.ico',
  'docs/vps-preparation/pre-vps-finish-01/VPS-FIRST-RUN.md',
  'docs/vps-preparation/pre-vps-finish-01/DATA-AND-RELEASE.md',
];
const files = [...new Set([...collectBuildFiles(root), ...hostFiles])].map((item) => item.replace(/\\/g, '/')).sort();
const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'zavod-pre-vps-source-'));
const payloads = [];
for (const relative of files) {
  if (relative.startsWith('/') || relative.includes('..') || /(?:^|\/)(?:\.env|node_modules|uploads|runtime|backups)(?:\/|$)/i.test(relative)) {
    throw new Error(`Forbidden source path: ${relative}`);
  }
  const source = path.join(root, relative);
  const stat = fs.lstatSync(source);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`Unsafe source file: ${relative}`);
  const bytes = fs.readFileSync(source);
  const destination = path.join(stage, relative);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, bytes);
  payloads.push({ path: relative, bytes: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex') });
}
const canonical = crypto.createHash('sha256');
for (const item of payloads) canonical.update(`${item.path}\0${item.bytes}\0${item.sha256}\n`);
const manifest = {
  kind: 'ZAVOD_PRE_VPS_SOURCE_CANDIDATE',
  status: 'SOURCE_ONLY_NOT_LINUX_IMAGE',
  payloadCount: payloads.length,
  canonicalPayloadSha256: canonical.digest('hex'),
  buildSelectionOwner: 'setup/deployment-context.js:collectBuildFiles',
  payloads,
};
fs.writeFileSync(path.join(stage, 'RELEASE-MANIFEST.json'), `${JSON.stringify(manifest, null, 2)}\n`);
process.stdout.write(`${stage}\n`);
