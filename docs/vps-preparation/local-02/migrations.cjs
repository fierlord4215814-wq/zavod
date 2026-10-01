const { assert } = require('./harness.cjs');
const { ownRuntime, ownUrl, ownPrisma, verifyOwnDb } = require('./own-db.cjs');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const root = path.resolve(__dirname, '../../..');
const runtime = ownRuntime();
const stage = path.join(runtime, 'local02-prisma');
const logs = path.join(__dirname, 'logs');
fs.mkdirSync(logs, { recursive: true });
const cli = path.join(root, 'backend/node_modules/prisma/build/index.js');
const password = fs.readFileSync(path.join(runtime, 'secrets/db-password.txt'), 'utf8').trim();
const env = { ...process.env, DATABASE_URL: ownUrl(), PGHOST: '127.0.0.1', PGPORT: '15436', PGUSER: 'local01_owner', PGPASSWORD: password, PRISMA_GENERATE_SKIP_AUTOINSTALL: 'true' };
function run(name, exe, args, extra = {}) {
  const r = spawnSync(exe, args, { cwd: stage, env: { ...env, ...extra }, encoding: 'utf8', windowsHide: true, maxBuffer: 16e6 });
  const output = `${r.stdout || ''}${r.stderr || ''}`.replaceAll(password, '[REDACTED]').replace(/postgresql:\/\/[^\s"']+/g, '[OWN_DATABASE_URL]');
  fs.writeFileSync(path.join(logs, `${name}.txt`), output);
  console.log(`${name}: exit=${r.status}`);
  assert.equal(r.status, 0, `${name}: ${output.slice(-2000)}`);
  return output;
}
async function main() {
  const db = ownPrisma();
  try {
    console.log(await verifyOwnDb(db));
    const before = JSON.parse(fs.readFileSync(path.join(__dirname, 'before.json')));
    for (const item of before.migrations) assert.equal(createHash('sha256').update(fs.readFileSync(path.join(root, 'backend/prisma/migrations', item.name, 'migration.sql'))).digest('hex'), item.sha256);
    fs.mkdirSync(path.join(stage, 'prisma'), { recursive: true });
    const schema = fs.readFileSync(path.join(root, 'backend/prisma/schema.prisma'), 'utf8').replace('provider = "prisma-client-js"', `provider = "prisma-client-js"\n  output = "${path.join(stage, 'generated-client').replaceAll('\\', '/')}"`);
    fs.writeFileSync(path.join(stage, 'prisma/schema.prisma'), schema);
    fs.cpSync(path.join(root, 'backend/prisma/migrations'), path.join(stage, 'prisma/migrations'), { recursive: true });
    const mode = process.argv[2];
    if (mode === 'backup') {
      const backup = path.join(runtime, 'local02-before.dump');
      assert.equal(fs.existsSync(backup), false, 'Do not replace an existing backup');
      run('own-c1-before-dump', 'C:/Program Files/PostgreSQL/18/bin/pg_dump.exe', ['-Fc', '-f', backup, 'zavod_local01_c0']);
      fs.cpSync(path.join(runtime, 'uploads'), path.join(runtime, 'local02-before-uploads'), { recursive: true, errorOnExist: true, force: false });
      console.log('OWN_C1_BACKUP_COMPLETE');
    } else if (mode === 'generate') {
      run('prisma-validate', process.execPath, [cli, 'validate', '--schema', 'prisma/schema.prisma']);
      run('prisma-generate', process.execPath, [cli, 'generate', '--schema', 'prisma/schema.prisma']);
      const generated = path.join(stage, 'generated-client');
      const destination = path.join(root, 'backend/node_modules/.prisma/client');
      const engine = 'query_engine-windows.dll.node';
      const sha = (p) => createHash('sha256').update(fs.readFileSync(p)).digest('hex');
      assert.equal(sha(path.join(generated, engine)), sha(path.join(destination, engine)), 'Same installed Prisma engine required');
      fs.cpSync(generated, destination, { recursive: true, filter: (source) => path.basename(source) !== engine });
      console.log('Generated client copied; identical installed engine retained, dependencies unchanged');
    } else if (mode === 'sql') {
      for (const name of ['zavod_local02_fresh', 'zavod_local02_upgrade']) {
        assert.equal((await db.$queryRawUnsafe('SELECT datname FROM pg_database WHERE datname = $1', name)).length, 0, 'Target must be new');
        await db.$executeRawUnsafe(`CREATE DATABASE "${name}" OWNER local01_owner`);
        if (name.endsWith('upgrade')) run('upgrade-restore56', 'C:/Program Files/PostgreSQL/18/bin/pg_restore.exe', ['--exit-on-error', '--no-owner', '-d', name, path.join(runtime, 'local02-before.dump')]);
        run(`${name}-deploy`, process.execPath, [cli, 'migrate', 'deploy', '--schema', 'prisma/schema.prisma'], { DATABASE_URL: ownUrl(name) });
        run(`${name}-diff`, process.execPath, [cli, 'migrate', 'diff', '--from-url', ownUrl(name), '--to-schema-datamodel', 'prisma/schema.prisma', '--exit-code']);
        const target = ownPrisma(name);
        try { await verifyOwnDb(target, name); assert.equal(await target.$queryRawUnsafe('SELECT COUNT(*)::int AS count FROM "_prisma_migrations" WHERE finished_at IS NOT NULL').then(r => r[0].count), 57); } finally { await target.$disconnect(); }
      }
      console.log('FRESH57_UPGRADE56_TO57_STRICT_DIFF_PASS');
    } else if (mode === 'verify') {
      run('prisma-validate-final', process.execPath, [cli, 'validate', '--schema', 'prisma/schema.prisma']);
      for (const name of ['zavod_local02_fresh', 'zavod_local02_upgrade', 'zavod_local01_c0', 'zavod_local02_restore']) {
        run(`${name}-final-diff`, process.execPath, [cli, 'migrate', 'diff', '--from-url', ownUrl(name), '--to-schema-datamodel', 'prisma/schema.prisma', '--exit-code']);
      }
    } else if (mode === 'c1') {
      assert.ok(fs.existsSync(path.join(runtime, 'local02-before.dump')));
      run('own-c1-deploy57', process.execPath, [cli, 'migrate', 'deploy', '--schema', 'prisma/schema.prisma']);
      run('own-c1-diff57', process.execPath, [cli, 'migrate', 'diff', '--from-url', ownUrl(), '--to-schema-datamodel', 'prisma/schema.prisma', '--exit-code']);
    } else throw Error('Expected backup/generate/sql/c1');
  } finally { await db.$disconnect(); }
}
main().catch(e => { console.error(e.message.replaceAll(password, '[REDACTED]')); process.exitCode = 1; });
