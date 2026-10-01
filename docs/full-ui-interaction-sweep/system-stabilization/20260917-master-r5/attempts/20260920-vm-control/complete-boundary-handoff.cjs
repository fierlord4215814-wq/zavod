'use strict';
// Resume the failed evidence-only finalizer after its immutable identity outputs.
// No product imports, network, service/DB probes, VM commands or overwritten evidence.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const cp = require('node:child_process');
const assert = require('node:assert/strict');
const here = __dirname;
const batch = path.resolve(here, '../..');
const root = path.resolve(batch, '../../../..');
const p19 = path.join(batch, 'attempts/20260918-hyperv-ubuntu24/post-reboot-20260919');
const rel = p => path.relative(root, p).replaceAll('\\', '/');
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
function safe(p) {
  const q = rel(p);
  assert.ok(!q.startsWith('..') && !path.isAbsolute(q));
  assert.ok(!/(^|\/)(\.env[^/]*|uploads|\.git|node_modules|credentials|cookies[^/]*|storageState[^/]*|private)(\/|$)/i.test(q), 'Excluded path');
  for (let x = p; x !== root; x = path.dirname(x)) assert.ok(!fs.lstatSync(x).isSymbolicLink(), 'Reparse path');
  return p;
}
const bytes = p => fs.readFileSync(safe(p));
const read = p => JSON.parse(bytes(p).toString('utf8').replace(/^\uFEFF/, ''));
const record = p => { const b = bytes(p); return { path: rel(p), bytes: b.length, sha256: sha(b) }; };
function put(name, data) {
  const p = path.join(here, name);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, Buffer.isBuffer(data) || typeof data === 'string' ? data : JSON.stringify(data, null, 2), { flag: 'wx' });
  return record(p);
}
for (const name of ['environment-runtime-receipt.json', 'source-delta-manifest.json', 'changed-files.txt', 'control-evidence']) {
  assert.ok(!fs.existsSync(path.join(here, name)), 'Preserve previous completion output: ' + name);
}
// Read every required input before creating further output.
const base = read(path.join(p19, 'baseline.json'));
const identity = read(path.join(here, 'final-identities.json'));
const observed = read(path.join(here, 'final-runtime-observation.json'));
const created = read(path.join(here, 'vm-created.json'));
const host = read(path.join(here, 'host-observation.json'));
const image = read(path.join(here, 'image-download-result.json'));
const seed = read(path.join(here, 'seed-media-receipt.json'));
const payload = read(path.join(here, 'source-payload-manifest.json'));
const rows = base.before.map(row => {
  const before = record(path.join(root, row.path));
  assert.equal(before.sha256, row.sha256);
  const after = record(path.join(here, 'handoff/after', row.owner));
  assert.equal(sha(bytes(path.join(root, row.owner))), after.sha256, 'Frozen owner changed: ' + row.owner);
  const diffPath = path.join(here, 'handoff/diffs', row.owner + '.diff');
  const diff = record(diffPath);
  const rerender = cp.spawnSync('git', ['-c', 'safe.directory=' + root, 'diff', '--no-index', '--no-ext-diff', '--', path.join(root, row.path), path.join(root, after.path)], { cwd: root, encoding: 'utf8', windowsHide: true, maxBuffer: 6 * 1024 * 1024 });
  assert.ok([0, 1].includes(rerender.status));
  assert.equal(sha(Buffer.from(rerender.stdout)), diff.sha256, 'Retained diff differs');
  return { owner: row.owner, before, after, changed: after.sha256 !== before.sha256, diff };
});
for (const g of identity.groups) for (const f of g.files) {
  assert.equal(f.sha256, f.expected);
  assert.equal(sha(bytes(path.join(root, f.owner))), f.sha256, 'Frozen source/build/harness changed');
}
for (const m of identity.matrices) {
  assert.equal(m.sha256, m.expected);
  assert.equal(sha(bytes(path.join(root, m.path))), m.sha256);
  assert.equal(sha(bytes(path.join(root, m.copy.path))), m.sha256);
}
for (const z of identity.priorZips) assert.equal(sha(bytes(path.join(root, z.path))), z.sha256);
for (const h of identity.historicalEntryRetention) {
  const p = h.preservedAs === 'ORIGINAL_BYTES' ? path.join(batch, h.name) : path.join(root, h.preservedAs);
  assert.equal(sha(bytes(p)), h.expected, 'Prior evidence not retained');
}
const git = args => cp.execFileSync('git', ['-c', 'safe.directory=' + root, ...args], { cwd: root, encoding: 'utf8', windowsHide: true }).trim();
assert.equal(git(['rev-parse', 'HEAD']), identity.head);
assert.equal(git(['branch', '--show-current']), identity.branch);
const qroot = path.join(root, '.r5-runtime/master-r5-ubuntu24/control');
const pendingCopies = observed.queue.filter(q => q.exists).map(q => {
  const b = bytes(path.join(qroot, q.name));
  assert.equal(sha(b), q.sha256, 'Queue changed since snapshot; preserve and make a new named observation');
  return { name: q.name, bytes: b };
});
for (const q of observed.queue.filter(q => !q.exists)) assert.ok(!fs.existsSync(path.join(qroot, q.name)), 'Queue advanced after snapshot; use a new named observation');
const result = id => {
  const q = pendingCopies.find(q => q.name === id + '.result.json');
  return q ? JSON.parse(q.bytes.toString('utf8').replace(/^\uFEFF/, '')) : null;
};
const boot = result('000002'), shutdown = result('000006'), exit = result('000007');
assert.equal(boot.vmId, created.vmId);
assert.equal(observed.observerStarted, false);
assert.equal(observed.prepProxyStarted, false);
const sameOwnProcess = observed.ownCoordinator.pid === 9056 && observed.ownCoordinator.name === 'pwsh' && observed.ownCoordinator.start === '2026-09-20T08:26:22.4640876+03:00';
const queueCopies = pendingCopies.map(q => ({ name: q.name, ...put('control-evidence/' + q.name, q.bytes) }));
const runtime = {
  at: new Date().toISOString(), observationAt: observed.at,
  status: 'BLOCKED_CONSOLE_OBSERVATION_PERMISSION_NOT_LIVE_ACCEPTANCE', host,
  vmIdentity: { vmId: created.vmId, name: created.name, bios: created.bios, vhd: created.vhd, geometry: created.vhdGeometry, network: created.network, switchId: created.switchId, switchType: created.switchType, createdAt: created.at },
  coordinator: { ...observed.ownCoordinator, sameOwnedProcessIdentity: sameOwnProcess, actualTokenProof: 'vm-control-before.json', actualTokenElevatedAtCreation: created.actualTokenElevated },
  shutdown: { request: '000006', requested: true, executionStartIndependentlyObserved: false, terminal: shutdown, status: shutdown ? shutdown.status : 'PENDING_EXECUTION_AND_COMPLETION_UNVERIFIED', force: false, turnOff: false },
  coordinatorExit: { request: '000007', terminal: exit, status: exit ? exit.status : 'QUEUED_UNVERIFIED' },
  lastConfirmedVmState: { at: boot.at, state: boot.result.vm.State, meaning: 'RUNNING' },
  currentVmOffProven: shutdown?.status === 'COMPLETED' && shutdown?.result?.vm?.State === 3,
  observer: { approval: 'REQUESTED_NOT_RECEIVED', uacRequestExists: observed.observerUacRequestExists, executed: observed.observerStarted },
  image, seedMetadata: seed, sourcePayload: payload.archive,
  guestInstall: 'UNVERIFIED_NO_NATIVE_CONSOLE', guestTransfer: 'NOT_RUN', canaryRoundTrip: 'NOT_RUN', isolationProof: 'NOT_RUN', appStack: 'NOT_RUN',
  appDbFixtures: [], ownFixtureCleanup: 'N_A_NONE_CREATED', workingRuntimeDataCleanup: 'UNKNOWN_NOT_INSPECTED',
  workingDbAccessed: false, workingDataEnvUploadsChanged: false, disMRepeated: false, hostRestartRequested: false,
  proxyStarted: observed.prepProxyStarted, freeDiskAtFinalObservation: observed.freeDiskBytes, ownedFilesMetadata: observed.artifacts, queueCopies,
  automaticForceOrCleanup: false,
  lifecycleLimit: 'Outer 8h loop deadline cannot interrupt a blocking synchronous cmdlet; queued shutdown has no start receipt. Do not infer execution or completion.',
  handoffHarnessCorrection: 'handoff-attempt1-error.json; previous immutable snapshots verified and reused, not overwritten'
};
put('environment-runtime-receipt.json', runtime);
const additions = [];
function walk(dir) {
  for (const x of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, x.name);
    assert.ok(!x.isSymbolicLink(), 'Reparse evidence');
    if (x.isDirectory()) walk(p); else additions.push(record(p));
  }
}
walk(p19); walk(here);
put('source-delta-manifest.json', {
  at: new Date().toISOString(), scope: 'AGGREGATE_POST_REBOOT19_20_SEPT_CONTINUATION; earlier dirty worktree not attributed',
  beforeBaseline: rel(path.join(p19, 'baseline.json')), retainedIdentity: record(path.join(here, 'final-identities.json')),
  existingOwners: rows, additionsAtCollection: additions, productFilesChanged: [], productFixes: 0, testsExecuted: false,
  systemChanges: ['One own Gen2 VM/VHDX', 'One own Internal switch and own /30 host IP; no NAT/firewall change'],
  priorZips: identity.priorZips, library: 'NOT_WRITTEN_PERSISTENCE_PENDING'
});
put('changed-files.txt', rows.filter(r => r.changed).map(r => 'MODIFIED_DOC_OR_R5_MATRIX ' + r.owner).concat(
  additions.map(r => 'ADDED_OWN_EVIDENCE_OR_HELPER ' + r.path),
  'Final source-delta/package manifest and receipt are independently listed by package-manifest.json/package-receipt.json.',
  'Runtime ISO/partial/tail/VHDX/private media/key/clean tar are excluded; preserved under .r5-runtime/master-r5-ubuntu24.'
).join('\n') + '\n');
console.log(JSON.stringify({
  status: 'EVIDENCE_ONLY_HANDOFF_COMPLETED', observationAt: observed.at,
  productUnchanged: identity.groups.map(g => ({ kind: g.kind, count: g.files.length })),
  parentMatricesUnchanged: identity.matrices.length, existingDocOwnersChanged: rows.filter(r => r.changed).length,
  priorEntriesRetained: identity.historicalEntryRetention.length, priorZipsUnchanged: identity.priorZips.length,
  currentVmOffProven: runtime.currentVmOffProven, shutdown: runtime.shutdown.status, sameOwnProcess, productCasesExecuted: 0
}));
