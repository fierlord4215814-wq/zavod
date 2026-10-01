const fs = require('node:fs');
const path = require('node:path');

const backendDir = path.resolve(__dirname, '..');
const rootDir = path.resolve(backendDir, '..');
const opsPath = path.join(backendDir, 'src', 'modules', 'ops', 'ops.service.ts');
const controllerPath = path.join(backendDir, 'src', 'modules', 'ops', 'ops.controller.ts');
const auditPath = path.join(backendDir, 'src', 'common', 'audit.service.ts');
const presentationPath = path.join(backendDir, 'src', 'common', 'audit-presentation.ts');
const screenPath = path.join(rootDir, 'frontend', 'src', 'screens', 'OpsAuditScreen.tsx');

const sources = Object.fromEntries([
  ['ops', opsPath], ['controller', controllerPath], ['audit', auditPath],
  ['presentation', presentationPath], ['screen', screenPath],
].map(([key, file]) => [key, fs.readFileSync(file, 'utf8')]));
const passed = [];
const failed = [];

function check(name, condition, evidence) {
  (condition ? passed : failed).push({ name, ...(evidence === undefined ? {} : { evidence }) });
}

function includesAll(source, values) {
  return values.every((value) => source.includes(value));
}

check('single ops controller owns statistics and audit routes', includesAll(sources.controller, [
  "@Get('operations/overview')", "@Get('events')", "@Get('audit')", "@Get('module-summary')",
]), controllerPath);
check('statistics reads canonical operational models', includesAll(sources.ops, [
  'db.lineEvent.findMany', 'db.task.findMany', 'db.checklistRun.findMany', 'db.washSession.findMany',
  'db.okkRecord.findMany', 'db.stockDefect.findMany', 'db.returnRecord.findMany',
]));
check('statistics uses factory-local server clock', sources.ops.includes('factoryServerNow()'));
check('all operational queries retain selected factory scope', (sources.ops.match(/factoryId: user\.selectedFactoryId/g) ?? []).length >= 20);
check('diagnostic visibility has one guarded owner', includesAll(sources.ops, ['includeOpsDiagnostics', 'isDiagnosticFixtureActor', 'visibleRecord']));
check('department filter uses canonical fixture visibility helper', sources.ops.includes('.filter((department) => this.visibleRecord(includeDiagnostics, department.id, department.name))'));
check('downtime request relation requires explicit line status event', sources.ops.includes('task.lineStatusEventId') && sources.ops.includes('downtimeLinked'));
check('period is half-open and open intervals are clipped', includesAll(sources.ops, [
  'lt: period.endExclusive', 'clippedStart', 'clippedEnd', 'period.asOf',
]));
check('median and p90 share canonical percentile helper', includesAll(sources.ops, [
  'private percentile(', 'this.percentile(downtimeDurations, 0.5)', 'this.percentile(downtimeDurations, 0.9)',
]));
check('audit reads canonical AuditLog service/table', sources.audit.includes('auditLog.create') && sources.ops.includes('db.auditLog.findMany'));
check('audit presentation is shared and human-readable', includesAll(sources.presentation, [
  'presentAuditDetails', 'KEY_LABELS', 'VALUE_LABELS', 'summary', 'rows',
]));
check('public audit response is explicit, not raw spread', !/return\s+\{\s*\.\.\.row/s.test(sources.ops));
check('frontend uses existing premium shell', includesAll(sources.screen, ['PremiumSectionHeader', 'PremiumSheet']));
check('frontend exposes one cohesive losses/events/audit/modules screen', includesAll(sources.screen, ["'Потери'", "'События'", "'Аудит'", "'Модули'"]));
check('no P16C entity or controlled formula is hardcoded in product owners', !/__PFFV5_P16C_|Линия Альфа|totalLostMinutes:\s*70/.test(`${sources.ops}\n${sources.screen}`));

console.log(`P16C_STATISTICS_SOURCE_REGRESSION: ${failed.length ? 'FAIL' : 'PASS'}`);
console.log(`passed=${passed.length} failed=${failed.length}`);
for (const item of failed) console.error(`FAIL ${item.name}${item.evidence ? `: ${JSON.stringify(item.evidence)}` : ''}`);
process.exitCode = failed.length ? 1 : 0;
