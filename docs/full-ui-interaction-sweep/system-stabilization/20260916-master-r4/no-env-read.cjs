// Extra offline-validator defense. Credentials are never inspected or logged.
const fs=require('node:fs'),path=require('node:path');
function deny(p){if(typeof p==='string'&&/^\.env(?:\.|$)/i.test(path.basename(p)))throw Error('R4_WORKING_ENV_READ_FORBIDDEN');}
for(const name of ['readFile','readFileSync','createReadStream','open','openSync']){const original=fs[name];fs[name]=function(p,...args){deny(p);return original.call(this,p,...args);};}
for(const name of ['readFile','open']){const original=fs.promises[name];fs.promises[name]=function(p,...args){deny(p);return original.call(this,p,...args);};}
