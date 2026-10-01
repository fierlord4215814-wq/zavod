// Evidence-only exporter: no product imports, services, network, database or test execution.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const cp = require('node:child_process');
const dir = __dirname, root = path.resolve(dir, '../../../..');
const prior = path.resolve(dir, '../20260916-master-r4');
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const read = p => JSON.parse(fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, ''));
const rel = p => path.relative(root, p).replaceAll('\\', '/');
const owners = ['README.md', 'docs/full-ui-interaction-sweep/progress.md', 'docs/full-ui-interaction-sweep/visual-gap-register.md'];
function safe(p) {
  const relative = path.relative(root, p);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw Error('Outside repository');
  if (/(^|[\\/])(\.env(?:\..*)?|uploads|\.git|node_modules|credentials|storageState[^\\/]*|cookies[^\\/]*)([\\/]|$)/i.test(relative)) throw Error('Excluded path');
  for (let current = p; current !== root; current = path.dirname(current)) {
    if (fs.lstatSync(current).isSymbolicLink()) throw Error('Reparse/symlink not allowed');
  }
  return p;
}
function write(name, data) {
  const p = path.join(dir, name);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, Buffer.isBuffer(data) || typeof data === 'string' ? data : JSON.stringify(data, null, 2), { flag: 'wx' });
  return { path: rel(p), bytes: fs.statSync(p).size, sha256: sha(fs.readFileSync(p)) };
}
const phase = process.argv[2];
if (phase === 'before') {
  const r4 = read(path.join(prior, 'handoff/parent-document-delta.json'));
  const rows = owners.map(owner => {
    const bytes = fs.readFileSync(safe(path.join(root, owner)));
    const expected = r4.rows.find(row => row.owner === owner).after.sha256;
    if (sha(bytes) !== expected) throw Error('Parent changed since R4; preserve and inspect: ' + owner);
    return { owner, before: write('snapshots/parent-before/' + owner, bytes), matchedR4After: true };
  });
  write('parent-before-manifest.json', { at: new Date().toISOString(), rows });
  console.log(JSON.stringify({ phase, saved: rows.length }));
} else if (phase === 'final') {
  const base = read(path.join(dir, 'baseline.json'));
  const comparisons = base.comparisons.map(group => ({
    kind: group.kind, declaredR4Identity: group.declaredIdentity,
    files: group.files.map(row => {
      const p = safe(path.join(root, row.owner)), bytes = fs.readFileSync(p);
      return { owner: row.owner, beforeSha256: row.currentSha256, afterSha256: sha(bytes), bytes: bytes.length, unchanged: sha(bytes) === row.currentSha256 };
    })
  }));
  const matrices = base.matrixComparisons.map(row => {
    const p = read(path.join(prior, 'handoff/parent-matrix-retention.json')).matrices.find(m => m.name === row.name).current.path;
    return { name: row.name, path: p, beforeSha256: row.current, afterSha256: sha(fs.readFileSync(safe(path.join(root, p)))) };
  });
  write('final-identities.json', { at: new Date().toISOString(), status: 'BYTE_RECHECK_NOT_BUILD_OR_TEST', comparisons, matrices,
    productConfigSchemaChanged: comparisons.find(g => g.kind === 'product').files.filter(f => !f.unchanged),
    buildChanged: comparisons.find(g => g.kind === 'build').files.filter(f => !f.unchanged),
    harnessChanged: comparisons.find(g => g.kind === 'harness').files.filter(f => !f.unchanged),
    schemaFiles: comparisons.flatMap(g => g.files).filter(f => /schema\.prisma$/.test(f.owner)),
    configFiles: base.comparisons.find(g => g.kind === 'product').files.slice(207).map(f => f.owner),
    r5FinalRegression: 'NOT_RUN_ENVIRONMENT_GATE' });
  const before = read(path.join(dir, 'parent-before-manifest.json'));
  const parentRows = before.rows.map(row => {
    const bytes = fs.readFileSync(safe(path.join(root, row.owner)));
    const after = write('handoff/parent-after/' + row.owner, bytes);
    const diff = cp.spawnSync('git', ['-c', 'safe.directory=' + root, 'diff', '--no-index', '--no-ext-diff', '--', path.join(root, row.before.path), path.join(root, after.path)], { cwd: root, encoding: 'utf8', windowsHide: true, maxBuffer: 5 * 1024 * 1024 });
    if (![0, 1].includes(diff.status)) throw Error('Document diff failed: ' + diff.stderr);
    return { ...row, after, diff: write('handoff/diffs/' + row.owner + '.diff', diff.stdout) };
  });
  write('source-delta-manifest.json', { at: new Date().toISOString(), existingOwnersChanged: parentRows, newBatchBefore: 'ABSENT_BASELINE', productEdits: [], testEdits: [], installerExecuted: false, library: 'NOT_WRITTEN_PERSISTENCE_PENDING' });
  const gates = base.gates.map(g => ({ id: g.id, source: g.source, owners: g.owners,
    isolated: { ...g.isolated, generation: 'R4_HISTORICAL_NOT_R5_RUN' }, required: g.required,
    liveTestStack: { cases: 0, status: 'NOT_RUN_ENVIRONMENT_UAC_AND_COMPATIBILITY' }, physical: 'PENDING' }));
  write('live-gate-matrix.json', { gates, uniqueLiveCases: 0, inheritedCountsMayOverlap: true });
  const journeys = read(path.join(prior, 'handoff/integrated-journeys-matrix.json'));
  write('journey-matrix.json', { count: journeys.count, edgeDenominator: journeys.edgeDenominator, newRealJourneys: 0,
    journeys: journeys.journeys.map(j => ({ id: j.id, retainedScope: j.status, retainedProof: j.oldProof, retainedLimit: j.oldLimit,
      r4Residual: j.r4.extraLimit, r5: 'NOT_RUN_ENVIRONMENT_GATE', source: rel(path.join(prior, 'handoff/integrated-journeys-matrix.json')) })) });
  const r5Status = cp.execFileSync('git', ['-c', 'safe.directory=' + root, 'status', '--short', '--untracked-files=normal'], { cwd: root, encoding: 'utf8', windowsHide: true });
  write('dirty-at-handoff.txt', r5Status);
  const refs = ['final-report.md', 'environment-and-parity.md', 'decision-queue.md', 'INDEX.md', 'root-result-matrix.md',
    'historical-extractor-spec.md', 'remaining-live-and-physical.md',
    'G2/final-product-identity.json', 'G2/final-build-identity.json', 'handoff/final-harness-identity-v2.json',
    'handoff/final-test-manifest.json', 'handoff/source-delta-manifest.json', 'handoff/live-gate-matrix.json',
    'handoff/integrated-journeys-matrix.json', 'handoff/native-evidence-index.json', 'handoff/shift-log-19-bindings.json', 'handoff/parent-matrix-retention.json'];
  const copied = refs.map(name => ({ owner: rel(path.join(prior, name)), ...write('references/R4/' + name, fs.readFileSync(safe(path.join(prior, name)))) }));
  for (const name of ['AGENTS.md', 'docs/v1-completion-goal.md']) copied.push({ owner: name, ...write('references/current-rules/' + name, fs.readFileSync(safe(path.join(root, name)))) });
  const requestPath = 'C:/Users/79164/.codex/attachments/7a8c2b55-c3f7-4b69-ba61-fecde91235c0/pasted-text.txt';
  copied.push({ owner: 'Explicit user request 7a8c2b55-c3f7-4b69-ba61-fecde91235c0', ...write('references/master-r5-request.txt', fs.readFileSync(requestPath)) });
  write('reference-manifest.json', { at: new Date().toISOString(), rows: copied, note: 'Exact references, not newly executed evidence. Native images remain at original retained paths; no R5 captures.' });
  const uac = read(path.join(dir, 'install-uac-terminal.json'));
  write('environment-runtime-receipt.json', { at: new Date().toISOString(), evidence: ['environment-inventory-host.json', 'license-policy-observation.json', 'install-uac-terminal.json'],
    callerSession: 50801, callerExitCode: 1, uac, elevatedInstallerPid: null, elevatedInstallerStarted: false,
    installationReceipts: ['install-uac-start.json', 'install-before-features.json', 'install-result.json'].map(name => ({ name, exists: fs.existsSync(path.join(dir, name)) })),
    componentsInstalledByR5: [], componentsEnabledByR5: [], systemConfigurationChanges: [], automaticReboot: false,
    restartRequirement: 'UNKNOWN_NO_INSTALL_RESULT_DO_NOT_REQUEST_REBOOT',
    compatibility: 'WINDOWS_SANDBOX_HARDWARE_LICENSE_CANDIDATE_NOT_FULL_STACK_APPROVED_PLAYWRIGHT_1_60_WIN10_NOT_LISTED',
    provisionedEnvironment: null, observedEnvironmentIdentity: null, isolationProof: 'NOT_RUN_NO_GUEST',
    negativeCases: ['manifest_identity_substitution', 'foreign_target', 'unexpected_mount', 'wrong_environment', 'forbidden_destination', 'missing_provision_isolation_gate'].map(id => ({ id, result: 'NOT_RUN' })),
    ownedRuntime: [], ownedRuntimeStatus: 'NO_APP_DB_BROWSER_VM_PROCESS_STARTED', syntheticFixtureStatus: 'NONE_CREATED',
    workingDbAccessed: false, workingDataEnvUploadsChanged: false, existingWorkingRuntimeStatus: 'UNKNOWN_NOT_INSPECTED',
    rollback: 'No installed mechanism to uninstall. Preserve evidence and UAC error; do not delete guards or retry without confirmation.' });
  write('fixture-ledger.json', { at: new Date().toISOString(), status: 'NOT_PROVISIONED_NO_FIXTURES_CREATED', runId: null,
    environments: [], databases: [], actors: [], entities: [], operations: [], files: [], credentialsExported: false,
    ownCleanup: 'NOT_APPLICABLE_NONE_CREATED', workingDataCleanup: 'UNKNOWN_NOT_ACCESSED' });
  write('expected-actual.json', { stage: 8, result: 'NOT_RUN_ENVIRONMENT_GATE', r5FinalGenerationFrozen: false,
    expectedR5Ids: null, actualR5CaseResults: [], executedR5Node: 0, executedR5Browser: 0, executedR5Live: 0,
    nodeBrowserHistoricalCatalog: { source: 'references/R4/handoff/final-test-manifest.json', counts: base.priorCaseCatalog.counts, isR5Execution: false },
    typesBuildsPrisma: 'NOT_RUN_R5_PRODUCT_UNCHANGED', runtimeInstallFailureClass: 'ENV_UAC_CANCELLED',
    ownProcessOrderingCorrection: 'Full stack compatibility review completed after unsuccessful UAC; selection withdrawn pending supported guest path',
    nativeR5Captured: 0, nativeR5Viewed: 0 });
  console.log(JSON.stringify({ phase, productBuildHarnessChanged: comparisons.flatMap(g => g.files).filter(f => !f.unchanged).length, matrixChanges: matrices.filter(m => m.beforeSha256 !== m.afterSha256).length, parents: parentRows.length, gates: gates.length, journeys: journeys.count, referenceFiles: copied.length }));
} else throw Error('Use before or final; neither phase executes product/runtime');
