const { spawnSync } = require('node:child_process');

const commands = [
  ['npm.cmd', ['run', 'db:doctor', '--workspace', 'backend']],
  ['npm.cmd', ['run', 'prisma:validate', '--workspace', 'backend']],
  ['npm.cmd', ['run', 'prisma:generate', '--workspace', 'backend']],
  ['npm.cmd', ['run', 'prisma:migrate:status', '--workspace', 'backend']],
  ['npm.cmd', ['run', 'build', '--workspace', 'backend']],
  ['npm.cmd', ['run', 'build', '--workspace', 'frontend']],
  ...[
    'stage6:regression',
    'stage7:admin-regression',
    'stage8:attachments-regression',
    'stage9:shift-regression',
    'stage10:tasks-regression',
    'stage11:wash-regression',
    'stage115:auth-regression',
    'stage12:orders-regression',
    'stage13:checklists-regression',
    'stage131:checklists-hardening-regression',
    'stage14:shift-log-regression',
    'stage15:defrost-regression',
    'stage16:quality-stock-returns-regression',
    'stage17:notifications-regression',
    'stage171:notification-hooks-regression',
    'stage18:ops-audit-regression',
    'stage19:pwa-offline-regression',
    'stage191:browser-pwa-sanity',
    'stage20:production-hardening-regression',
    'stage21:role-shift-simulation',
    'stage23:chats-regression',
    'stage231:tail-hardening-regression',
    'stage24:announcements-regression',
    'stage25:people-profile-skills-regression',
    'stage26:line-skills-okk-table-regression',
    'stage27:store-returns-work-areas-regression',
    'stage28:menu-role-visibility-regression',
    'stage29:admin-config-coverage-regression',
    'stage30:release-readiness-regression',
  ].map((script) => ['npm.cmd', ['run', script, '--workspace', 'backend']]),
  ['node', ['--check', 'backend/prisma/seed.js']],
  ['rg', ['window\\.(prompt|alert|confirm)|\\balert\\(', 'frontend/src']],
  ['rg', ['�|����|Ð|Рџ|Рђ|Рќ|Р |вЂ', 'frontend/src', 'frontend/public', 'docs']],
];

if (process.env.RUN_STAGE30_FULL_GATE !== '1') {
  console.log('Stage 30 full gate command order:');
  for (const [cmd, args] of commands) console.log(`${cmd} ${args.join(' ')}`);
  console.log('Set RUN_STAGE30_FULL_GATE=1 to execute the full gate from this wrapper.');
  process.exit(0);
}

for (const [cmd, args] of commands) {
  console.log(`\n=== ${cmd} ${args.join(' ')} ===`);
  const result = spawnSync(cmd, args, { stdio: 'inherit', shell: false });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
