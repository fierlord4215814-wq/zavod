// Scoped test orchestration only. Canonical application and commands are reused.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'../../..'),runtime='C:\\Users\\79164\\AppData\\Local\\Zavod-Factory01\\run-20260926-t1';
const database='zavod_factory01_t1',port=15437,pgBin='C:\\Program Files\\PostgreSQL\\18\\bin';
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const secret=k=>fs.readFileSync(path.join(runtime,'secrets',k+'.txt'),'utf8').trim();
function url(name=database){assert(['zavod_factory01_t1','zavod_factory01_restore','zavod_factory01_handover','zavod_factory01_handover_restore','postgres'].includes(name));return `postgresql://factory01_owner:${encodeURIComponent(secret('db-password'))}@127.0.0.1:${port}/${name}?schema=public`;}
function prisma(name=database){const{PrismaClient}=require(path.join(root,'backend/node_modules/@prisma/client'));return new PrismaClient({datasources:{db:{url:url(name)}}});}
async function verify(p,name=database){const [r]=await p.$queryRawUnsafe("SELECT current_database() AS db, inet_server_port() AS port, current_setting('data_directory') AS data");assert.equal(r.db,name);assert.equal(r.port,port);assert.equal(path.resolve(r.data).toLowerCase(),path.join(runtime,'pgdata').toLowerCase());return r;}
const business=['shiftSession','assignment','plannedLineAssignment','plannedShiftAssignment','shiftWillBe','task','minimumStockItem','orderRequest','chat','chatMessage','announcement','checklistRun','attachment','washSession','defrostEvent','shiftLog','okkRecord','returnRecord','stockDefect'];
async function counts(p){const r={};for(const k of ['factory','user','userFactoryAccess',...business])r[k]=await p[k].count();return r;}
const safeError=e=>String(e?.message??e).replace(/postgres(?:ql)?:\/\/[^\s"']+/g,'[OWN_DATABASE_URL]');
const receipt=(name,data)=>fs.writeFileSync(path.join(__dirname,name+'.json'),JSON.stringify(data,null,2));
module.exports={fs,path,assert,crypto,root,runtime,database,port,pgBin,sha,secret,url,prisma,verify,business,counts,receipt,safeError};
