const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const cp = require('node:child_process');
const root = path.resolve(__dirname, '../../../..');
const owners = ['frontend/src/App.tsx','frontend/src/styles.css','frontend/src/screens/TasksScreen.tsx','frontend/src/screens/PeopleScreen.tsx','frontend/src/screens/ShiftPeopleScreen.tsx','frontend/src/screens/SituationScreen.tsx','frontend/src/screens/NotificationsScreen.tsx','frontend/src/components/ActionModal.tsx','frontend/src/navigation/mobile-back.ts','frontend/src/notifications/browser-notifications.ts','frontend/e2e/frontend-series.spec.ts'];
const phase = process.argv[2];
if (!/^(baseline|A-before|A-after|B-before|B-after|C-before|C-after|D-before|D-after|final|handoff)$/.test(phase)) throw Error('Invalid phase');
const destination = path.join(__dirname, 'snapshots', phase);
if (fs.existsSync(destination)) throw Error('Snapshot already exists');
const records = [];
for (const owner of owners) {
  const source = path.join(root, owner);
  if (!fs.existsSync(source)) { records.push({owner, exists:false}); continue; }
  const buffer = fs.readFileSync(source);
  const target = path.join(destination, owner);
  fs.mkdirSync(path.dirname(target), {recursive:true});
  fs.writeFileSync(target, buffer);
  records.push({owner, sha256:crypto.createHash('sha256').update(buffer).digest('hex'), bytes:buffer.length});
}
const git = (...args) => cp.execFileSync('git', args, {cwd:root,encoding:'utf8'});
fs.writeFileSync(path.join(destination,'manifest.json'),JSON.stringify({time:new Date().toISOString(),head:git('rev-parse','HEAD').trim(),branch:git('branch','--show-current').trim(),status:git('status','--short','--',...owners),records},null,2));
console.log(destination);
