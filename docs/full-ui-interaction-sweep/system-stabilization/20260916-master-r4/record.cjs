// Pinned R2 recorder; R4 artifacts only. No backend/database bootstrap.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),Module=require('node:module'),assert=require('node:assert/strict');
assert.ok(['snapshot','check','run'].includes(process.argv[2]));
const core=path.resolve(__dirname,'../20260915-master-r2/artifacts.cjs');
let source=fs.readFileSync(core,'utf8');
assert.equal(crypto.createHash('sha256').update(source).digest('hex'),'fb9f862e94b4c0fc3723508ef6c1731b528c3c478927f3ab2b5f88d3bb1f6515');
// No .env or ambient database/auth/provider/Vite configuration inherited by children.
const from='env:{...process.env,...env}';
assert.equal(source.split(from).length,2);
source=source.replace(from,"env:{...Object.fromEntries(Object.entries(process.env).filter(([k])=>/^(SystemRoot|WINDIR|COMSPEC|PATH|PATHEXT|TEMP|TMP|USERPROFILE|LOCALAPPDATA|APPDATA|PROGRAMFILES|PROGRAMFILES\\(X86\\)|ProgramData|NUMBER_OF_PROCESSORS)$/i.test(k))),...env}");
const inherited=new Module(path.join(__dirname,'inherited-r2-recorder.cjs'),module);
inherited.filename=path.join(__dirname,'inherited-r2-recorder.cjs');inherited.paths=module.paths;inherited._compile(source,inherited.filename);
