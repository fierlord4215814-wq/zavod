// Reuse the immutable R2 recorder implementation; only its batch directory changes.
// No product module, DB client or application bootstrap is loaded by this adapter.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const Module = require('node:module');
if (!['snapshot', 'check', 'run'].includes(process.argv[2])) throw new Error('Use inherited snapshot/check/run only');
const core = path.resolve(__dirname, '../20260915-master-r2/artifacts.cjs');
const source = fs.readFileSync(core);
const expected = 'fb9f862e94b4c0fc3723508ef6c1731b528c3c478927f3ab2b5f88d3bb1f6515';
if (crypto.createHash('sha256').update(source).digest('hex') !== expected) throw new Error('R2 recorder changed: inspect before reuse');
const inherited = new Module(path.join(__dirname, 'inherited-r2-recorder.cjs'), module);
inherited.filename = path.join(__dirname, 'inherited-r2-recorder.cjs');
inherited.paths = module.paths;
inherited._compile(source.toString('utf8'), inherited.filename);
