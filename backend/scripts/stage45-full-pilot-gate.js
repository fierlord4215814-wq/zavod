const { spawnSync } = require('node:child_process');
const path = require('node:path');

const rootDir = path.resolve(__dirname, '..', '..');
const run = process.argv.includes('--run');
const full = process.argv.includes('--full');

const quickGate = [
  ['npm.cmd', ['run', 'db:doctor', '--workspace', 'backend']],
  ['npm.cmd', ['run', 'prisma:validate', '--workspace', 'backend']],
  ['npm.cmd', ['run', 'prisma:generate', '--workspace', 'backend']],
  ['npm.cmd', ['run', 'prisma:migrate:status', '--workspace', 'backend']],
  ['npm.cmd', ['run', 'build', '--workspace', 'backend']],
  ['npm.cmd', ['run', 'build', '--workspace', 'frontend']],
  ['npm.cmd', ['run', 'stage45:pilot-readiness-regression', '--workspace', 'backend']],
  ['npm.cmd', ['run', 'stage45:browser-e2e']],
  ['npm.cmd', ['run', 'stage44:checklist-builder-guided-run-regression', '--workspace', 'backend']],
  ['npm.cmd', ['run', 'stage44:browser-e2e']],
  ['npm.cmd', ['run', 'stage43:mobile-attachments-regression', '--workspace', 'backend']],
  ['npm.cmd', ['run', 'stage43:browser-e2e']],
  ['npm.cmd', ['run', 'stage42:operational-closure-regression', '--workspace', 'backend']],
  ['npm.cmd', ['run', 'stage42:browser-e2e']],
  ['npm.cmd', ['run', 'stage40b:downtime-task-analytics-regression', '--workspace', 'backend']],
  ['npm.cmd', ['run', 'stage40a:archive-center-regression', '--workspace', 'backend']],
  ['npm.cmd', ['run', 'stage39:system-coherence-regression', '--workspace', 'backend']],
  ['npm.cmd', ['run', 'stage30:release-readiness-regression', '--workspace', 'backend']],
  ['node', ['--check', 'backend/prisma/seed.js']],
];

const fullGate = [
  ...Array.from({ length: 16 }, (_, index) => index + 6)
    .filter((stage) => stage !== 22)
    .map((stage) => ['npm.cmd', ['run', `stage${stage}:${stage === 7 ? 'admin-regression' : stage === 8 ? 'attachments-regression' : stage === 9 ? 'shift-regression' : stage === 10 ? 'tasks-regression' : stage === 11 ? 'wash-regression' : stage === 12 ? 'orders-regression' : stage === 13 ? 'checklists-regression' : stage === 14 ? 'shift-log-regression' : stage === 15 ? 'defrost-regression' : stage === 16 ? 'quality-stock-returns-regression' : stage === 17 ? 'notifications-regression' : stage === 18 ? 'ops-audit-regression' : stage === 19 ? 'pwa-offline-regression' : stage === 20 ? 'production-hardening-regression' : stage === 21 ? 'role-shift-simulation' : 'regression'}`, '--workspace', 'backend']]),
  ['npm.cmd', ['run', 'stage115:auth-regression', '--workspace', 'backend']],
  ['npm.cmd', ['run', 'stage131:checklists-hardening-regression', '--workspace', 'backend']],
  ['npm.cmd', ['run', 'stage171:notification-hooks-regression', '--workspace', 'backend']],
  ['npm.cmd', ['run', 'stage23:chats-regression', '--workspace', 'backend']],
  ['npm.cmd', ['run', 'stage231:tail-hardening-regression', '--workspace', 'backend']],
  ['npm.cmd', ['run', 'stage24:announcements-regression', '--workspace', 'backend']],
  ['npm.cmd', ['run', 'stage25:people-profile-skills-regression', '--workspace', 'backend']],
  ['npm.cmd', ['run', 'stage26:line-skills-okk-table-regression', '--workspace', 'backend']],
  ['npm.cmd', ['run', 'stage27:store-returns-work-areas-regression', '--workspace', 'backend']],
  ['npm.cmd', ['run', 'stage28:menu-role-visibility-regression', '--workspace', 'backend']],
  ['npm.cmd', ['run', 'stage29:admin-config-coverage-regression', '--workspace', 'backend']],
  ['npm.cmd', ['run', 'stage30:release-readiness-regression', '--workspace', 'backend']],
  ...Array.from({ length: 15 }, (_, index) => index + 31).map((stage) => ['npm.cmd', ['run', `stage${stage}:browser-e2e`]]),
  ...quickGate,
];

function commandText([cmd, args]) {
  return `${cmd} ${args.join(' ')}`;
}

function execute(commands) {
  for (const command of commands) {
    console.log(`\n> ${commandText(command)}`);
    const result = spawnSync(command[0], command[1], {
      cwd: rootDir,
      stdio: 'inherit',
      shell: process.platform === 'win32',
      env: process.env,
    });
    if (result.status !== 0) {
      process.exit(result.status ?? 1);
    }
  }
}

const selected = full ? fullGate : quickGate;
console.log(JSON.stringify({
  mode: full ? 'full' : 'quick',
  executable: run,
  commands: selected.map(commandText),
  note: run
    ? 'Running selected gate now.'
    : 'Dry list only. Add --run to execute, and --full for the long gate.',
}, null, 2));

if (run) execute(selected);
