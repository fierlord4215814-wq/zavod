// Read-only provenance of the explicitly owned C1; never loads dotenv.
const { assert } = require('../local-02/harness.cjs');
const { ownPrisma, verifyOwnDb } = require('../local-02/own-db.cjs');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const cp = require('node:child_process');
const out = __dirname;
const hash = p => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
function walk(p) { return fs.readdirSync(p, {withFileTypes:true}).flatMap(e => e.isDirectory() ? walk(path.join(p,e.name)) : [path.join(p,e.name)]); }
async function main() {
 const db = ownPrisma();
 try {
  const identity = await verifyOwnDb(db);
  const files = ['backend/src','frontend/src','backend/prisma/migrations','backend/dist','frontend/dist'].flatMap(walk).concat(['backend/prisma/schema.prisma','backend/prisma/system-foundation.cjs']).filter(p => !p.endsWith('.map'));
  const migrations = await db.$queryRawUnsafe('SELECT migration_name, checksum FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name');
  assert.equal(migrations.length,57);
  const users = await db.user.findMany({select:{id:true,firstName:true,lastName:true,blockedAt:true,deletedAt:true},orderBy:{createdAt:'asc'}});
  const access = await db.userFactoryAccess.findMany({select:{id:true,userId:true,factoryId:true,role:true,isActive:true,departmentId:true}});
  const factories = await db.factory.findMany({select:{id:true,code:true,name:true,isActive:true}});
  const counts = {};
  for(const table of ['ShiftSession','Assignment','PlannedShiftAssignment','ShiftWillBe','Task','OrderRequest','Chat','ChatMessage','Announcement','ChecklistTemplate','ChecklistRun','Attachment','WashSession','DefrostEvent','ShiftLog','AuditLog','Notification']) {
   counts[table] = Number((await db.$queryRawUnsafe(`SELECT count(*)::int AS n FROM "${table}"`))[0].n);
  }
  const fixtures={};
  for(const table of ['Line','Department','Task','ChecklistTemplate','ChecklistRun','WashSession','DefrostEvent','ShiftLog','MinimumStockItem','StockDefect','ReturnRecord','ShiftSession','PlannedShiftAssignment','ShiftWillBe']) fixtures[table]=await db.$queryRawUnsafe(`SELECT to_jsonb(t)->>'id' AS id, to_jsonb(t)->>'factoryId' AS factory, to_jsonb(t)->>'status' AS status, to_jsonb(t)->>'isActive' AS active, to_jsonb(t)->>'deletedAt' AS deleted, to_jsonb(t)->>'archivedAt' AS archived, to_jsonb(t)->>'releasedAt' AS released, to_jsonb(t)->>'cancelledAt' AS cancelled FROM "${table}" t`);
  const result={at:new Date().toISOString(),head:cp.execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),identity,migrations,users,access,factories,counts,fixtures,files:files.map(p=>({path:p.replaceAll('\\','/'),sha256:hash(p),bytes:fs.statSync(p).size}))};
  const target=path.join(out,process.argv[2]==='pre-product'?'pre-product.json':'before.json');assert.ok(!fs.existsSync(target),'Baseline must not be overwritten');fs.writeFileSync(target,JSON.stringify(result,null,2));
  console.log(JSON.stringify({identity,migrations:migrations.length,users:users.length,activeAccess:access.filter(a=>a.isActive).length,factories,counts,hashedFiles:files.length}));
 } finally {await db.$disconnect();}
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
