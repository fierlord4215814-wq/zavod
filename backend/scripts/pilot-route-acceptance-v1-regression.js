const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..', '..');
const evidenceDir = path.join(root, 'docs', 'pilot-route-acceptance-v1');
const logsDir = path.join(evidenceDir, 'logs');
const resultsPath = path.join(evidenceDir, 'results.json');
const startedAt = new Date();
const runId = process.env.PILOT_ROUTE_V1_RUN_ID || `PILOT_ROUTE_V1_${startedAt.toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}`;

const allRoutes = Array.from({ length: 14 }, (_, index) => index + 1);
const gates = [
  { id: 'backend-build', command: 'npm.cmd run build --workspace backend', routes: allRoutes },
  { id: 'frontend-build', command: 'npm.cmd run build --workspace frontend', routes: allRoutes },
  { id: 'prisma-validate', command: 'npm.cmd run prisma:validate --workspace backend', routes: allRoutes },
  { id: 'prisma-status', command: 'npm.cmd run prisma:migrate:status --workspace backend', routes: allRoutes },
  { id: 'seed-syntax', command: 'node --check backend/prisma/seed.js', routes: allRoutes },
  { id: 'guest-rbac', command: 'npm.cmd run guest:rbac-menu-regression --workspace backend', routes: [1, 2] },
  { id: 'role-hierarchy', command: 'npm.cmd run role-hierarchy:delegation-regression --workspace backend', routes: [1, 14] },
  { id: 'shift-assignments', command: 'npm.cmd run stage41:line-shift-assignment-regression --workspace backend', routes: [2, 3, 4] },
  { id: 'shift-transition', command: 'npm.cmd run prepilot:shift-transition-archive-regression --workspace backend', routes: [2, 3, 9] },
  { id: 'line-timeline', command: 'npm.cmd run line:timeline-regression --workspace backend', routes: [5, 6, 7, 11, 13] },
  { id: 'lines-wash-defrost', command: 'npm.cmd run pilot:lines-wash-defrost-regression --workspace backend', routes: [5, 6, 7] },
  { id: 'tasks', command: 'npm.cmd run tasks:pilot-ready-regression --workspace backend', routes: [5] },
  { id: 'shock-chamber', command: 'npm.cmd run defrost:shock-chamber-blow-regression --workspace backend', routes: [7] },
  { id: 'checklist-workflow', command: 'npm.cmd run checklists:workflow-v1-regression --workspace backend', routes: [8] },
  { id: 'checklist-periodic', command: 'npm.cmd run checklists:periodic-lifecycle-regression --workspace backend', routes: [8] },
  { id: 'checklist-department', command: 'npm.cmd run checklists:department-first-v1-regression --workspace backend', routes: [8] },
  { id: 'shift-handover', command: 'npm.cmd run shift:handover-summary-regression --workspace backend', routes: [9] },
  { id: 'chat', command: 'npm.cmd run chat:mobile-messenger-v1-regression --workspace backend', routes: [10] },
  { id: 'announcements', command: 'npm.cmd run stage52:fullscreen-announcements-regression --workspace backend', routes: [10] },
  { id: 'notifications', command: 'npm.cmd run notifications:routing-v1-regression --workspace backend', routes: [10] },
  { id: 'quality-returns', command: 'npm.cmd run stage16:quality-stock-returns-regression --workspace backend', routes: [11, 12] },
  { id: 'orders-stock', command: 'npm.cmd run stage12:orders-regression --workspace backend', routes: [12] },
  { id: 'archive', command: 'npm.cmd run stage40a:archive-center-regression --workspace backend', routes: [13] },
  { id: 'downtime-analytics', command: 'npm.cmd run stage40b:downtime-task-analytics-regression --workspace backend', routes: [5, 13] },
  { id: 'security-privacy', command: 'npm.cmd run security:privacy-v1-regression --workspace backend', routes: [1, 10, 11, 12, 13, 14] },
  { id: 'runtime-hygiene', command: 'npm.cmd run runtime:data-hygiene-v1-regression --workspace backend', routes: [1, 5, 6, 7, 8, 10, 11, 12, 13] },
  { id: 'release-readiness', command: 'npm.cmd run stage30:release-readiness-regression --workspace backend', routes: allRoutes },
];

const carriedEvidence = [
  {
    id: 'semantic-integrity',
    path: 'docs/semantic-integrity-red-team-v1/audit-summary.md',
    routes: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 13, 14],
    requiredText: 'SEMANTIC_INTEGRITY: PASS',
  },
  {
    id: 'access-lifecycle',
    path: 'docs/v1-access-lifecycle-audit.md',
    routes: [1, 2, 14],
    requiredText: 'Открытых P0/P1/P2 по access lifecycle после свежего прогона нет.',
  },
  {
    id: 'live-role-change',
    path: 'docs/v1-live-role-change-audit.md',
    routes: [1, 2, 14],
    requiredText: 'Открытых P0/P1/P2 по live role-change перед ручным пилотом нет.',
  },
  {
    id: 'people-manual-search-screenshots',
    path: 'docs/pilot-people-manual-assignment-search-screenshots',
    routes: [4],
    requiredFiles: 10,
  },
];

function sanitizeOutput(value) {
  return String(value || '')
    .replace(/postgres(?:ql)?:\/\/[^\s"']+/gi, '[DATABASE_URL hidden]')
    .replace(/Bearer\s+[A-Za-z0-9._~+\/-]+=*/gi, 'Bearer [hidden]')
    .replace(/("?(?:passwordHash|accessToken|refreshToken|authToken|token|secret)"?\s*[:=]\s*)["']?[^\s,"'}]+/gi, '$1[hidden]')
    .replace(/\+7\d{10}/g, '+7**********')
    .replace(/([A-Za-z]:\\[^\r\n"']*uploads[^\r\n"']*)/gi, '[uploads path hidden]');
}

function writeUtf8(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, value, 'utf8');
}

function inspectCarriedEvidence(item) {
  const absolute = path.join(root, item.path);
  if (!fs.existsSync(absolute)) return { ...item, status: 'FAIL', reason: 'evidence path is missing' };
  const stat = fs.statSync(absolute);
  if (stat.isDirectory()) {
    const files = fs.readdirSync(absolute).filter((name) => !name.startsWith('.'));
    return {
      ...item,
      status: files.length >= item.requiredFiles ? 'PASS' : 'FAIL',
      fileCount: files.length,
      modifiedAt: stat.mtime.toISOString(),
    };
  }
  const content = fs.readFileSync(absolute, 'utf8');
  return {
    ...item,
    status: content.includes(item.requiredText) ? 'PASS' : 'FAIL',
    modifiedAt: stat.mtime.toISOString(),
  };
}

function runGate(gate) {
  const gateStartedAt = new Date();
  process.stdout.write(`\n[pilot-route] ${gate.id}: ${gate.command}\n`);
  const result = spawnSync(gate.command, [], {
    cwd: root,
    env: {
      ...process.env,
      PILOT_ROUTE_V1_RUN_ID: runId,
      PILOT_ROUTE_V1_OPERATION_ID: `${runId}_${gate.id}`,
    },
    shell: true,
    windowsHide: true,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    timeout: Number(process.env.PILOT_ROUTE_GATE_TIMEOUT_MS || 360_000),
  });
  const output = sanitizeOutput(`${result.stdout || ''}\n${result.stderr || ''}`);
  const logPath = path.join(logsDir, `${gate.id}.log`);
  writeUtf8(logPath, output);
  const status = result.status === 0 && !result.error ? 'PASS' : 'FAIL';
  process.stdout.write(`[pilot-route] ${gate.id}: ${status} (exit ${result.status ?? 1})\n`);
  return {
    id: gate.id,
    command: gate.command,
    routes: gate.routes,
    status,
    exitCode: result.status ?? 1,
    durationMs: Date.now() - gateStartedAt.getTime(),
    log: path.relative(root, logPath).replace(/\\/g, '/'),
    error: result.error ? sanitizeOutput(result.error.message) : null,
  };
}

function routeStatus(routeId, gateResults, evidenceResults) {
  const routeGates = gateResults.filter((item) => item.routes.includes(routeId));
  const routeEvidence = evidenceResults.filter((item) => item.routes.includes(routeId));
  const failures = [
    ...routeGates.filter((item) => item.status !== 'PASS').map((item) => item.id),
    ...routeEvidence.filter((item) => item.status !== 'PASS').map((item) => item.id),
  ];
  return {
    id: routeId,
    status: failures.length ? 'FAIL' : 'PASS',
    gates: routeGates.map((item) => item.id),
    carriedEvidence: routeEvidence.map((item) => item.id),
    failures,
  };
}

function writeManifest(gateResults, evidenceResults) {
  const lines = [
    '# Манифест тестовых данных',
    '',
    `- Run ID: \`${runId}\`.`,
    `- Начало: ${startedAt.toISOString()}.`,
    '- Сам orchestration runner не создаёт и не изменяет продуктовые записи.',
    '- Fresh regression-команды используют только уже существующие test/diagnostic helpers и их штатную provenance-маркировку.',
    '- Реальные пользователи и линии Завода 4 orchestration runner не перенастраивает; команды `pilot-pack:v1`, reset/drop/truncate/delete не запускаются.',
    '- Физическая очистка истории и uploads не выполняется.',
    '',
    '## Fresh helpers',
    '',
    '| Helper | Результат | Лог |',
    '|---|---|---|',
    ...gateResults.map((item) => `| \`${item.id}\` | ${item.status} | \`${item.log}\` |`),
    '',
    '## Переиспользованное evidence',
    '',
    '| Evidence | Результат | Путь | Обновлено |',
    '|---|---|---|---|',
    ...evidenceResults.map((item) => `| \`${item.id}\` | ${item.status} | \`${item.path}\` | ${item.modifiedAt || 'нет'} |`),
    '',
    'Все новые сущности, которые могли быть созданы fresh helper-скриптами, остаются только в их существующем diagnostic/test-контуре и завершаются, архивируются или деактивируются штатной логикой соответствующего helper. Реальные рабочие записи не удалялись.',
  ];
  writeUtf8(path.join(evidenceDir, 'test-data-manifest.md'), `${lines.join('\n')}\n`);
}

function writeFailures(gateResults, evidenceResults) {
  const failedGates = gateResults.filter((item) => item.status !== 'PASS');
  const failedEvidence = evidenceResults.filter((item) => item.status !== 'PASS');
  const lines = ['# Ошибки приёмки', ''];
  if (!failedGates.length && !failedEvidence.length) {
    lines.push('Fresh backend gates и обязательное carried evidence прошли без ошибок. Browser verdict добавляется отдельным frontend runner.');
  } else {
    for (const item of failedGates) lines.push(`- FAIL \`${item.id}\`: exit ${item.exitCode}; лог \`${item.log}\`.`);
    for (const item of failedEvidence) lines.push(`- FAIL evidence \`${item.id}\`: \`${item.path}\`.`);
  }
  writeUtf8(path.join(evidenceDir, 'failures.md'), `${lines.join('\n')}\n`);
}

async function main() {
  fs.mkdirSync(logsDir, { recursive: true });
  const evidenceResults = carriedEvidence.map(inspectCarriedEvidence);
  const gateResults = gates.map(runGate);
  const routes = allRoutes.map((routeId) => routeStatus(routeId, gateResults, evidenceResults));
  const completedAt = new Date();
  const status = routes.every((route) => route.status === 'PASS') ? 'PASS' : 'FAIL';
  const results = {
    schemaVersion: 1,
    runId,
    startedAt: startedAt.toISOString(),
    completedAt: completedAt.toISOString(),
    durationMs: completedAt.getTime() - startedAt.getTime(),
    status,
    migrationNeeded: false,
    destructiveOperations: [],
    gates: gateResults,
    carriedEvidence: evidenceResults,
    routes,
    browser: { status: 'PENDING', command: 'npm.cmd run pilot-route-acceptance:v1-e2e --workspace frontend' },
    physicalPhoneGate: 'PENDING',
  };
  writeUtf8(resultsPath, `${JSON.stringify(results, null, 2)}\n`);
  writeManifest(gateResults, evidenceResults);
  writeFailures(gateResults, evidenceResults);
  console.log(`pilot-route-acceptance-v1: ${status}; ${gateResults.filter((item) => item.status === 'PASS').length} passed, ${gateResults.filter((item) => item.status !== 'PASS').length} failed`);
  process.exitCode = status === 'PASS' ? 0 : 1;
}

void main();
