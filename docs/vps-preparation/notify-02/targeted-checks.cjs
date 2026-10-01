const o=require('./own.cjs'),{spawnSync}=require('node:child_process'),stamp=new Date().toISOString().replace(/[:.]/g,'-'),dir=o.path.join(__dirname,'checks',stamp);o.fs.mkdirSync(dir,{recursive:true});
const ev={atUtc:new Date().toISOString(),runs:[]};
function run(name,args,required=true){const r=spawnSync(process.execPath,args,{cwd:o.root,encoding:'utf8',windowsHide:true,maxBuffer:20e6});const output=o.safeError((r.stdout||'')+(r.stderr||''));o.fs.writeFileSync(o.path.join(dir,name+'.txt'),output);const counts=Object.fromEntries(['tests','pass','fail'].map(k=>[k,Number(output.match(new RegExp(`(?:#|ℹ) ${k} (\\d+)`))?.[1]||0)]));const result={name,exit:r.status,...counts,log:o.path.relative(__dirname,o.path.join(dir,name+'.txt')).replaceAll('\\','/')};ev.runs.push(result);o.receipt('targeted-checks',ev);console.log(JSON.stringify(result));if(required)o.assert.equal(r.status,0,name);}
try{
 run('backend-notification-orders-task',['--test','backend/scripts/notify-02.test.cjs','backend/scripts/task-notify-01.test.cjs','backend/scripts/master-r2-orders.test.js','backend/scripts/master-r2-task-chain.test.js','backend/scripts/master-r2-replay.test.js','backend/scripts/master-task-replay-boundary.test.js','backend/scripts/master-stateful-chain.test.js','backend/scripts/master-offline-contract.test.js']);
 run('stock-domain-targeted',['--test','--test-name-pattern=J18','backend/scripts/master-domain-contracts.test.js']);
 run('frontend-retained-navigation-ws',['--test','frontend/scripts/task-notify-navigation.test.cjs','frontend/scripts/master-ws-contract.test.cjs']);
 // Preserve the historically known unrelated J20 chat fixture failure; never turn it into a green claim.
 run('broad-domain-observation',['--test','backend/scripts/master-domain-contracts.test.js'],false);
 ev.status='PASS_TARGETED_WITH_SEPARATE_BROAD_DOMAIN_OBSERVATION';o.receipt('targeted-checks',ev);
}catch(e){ev.error=o.safeError(e);o.receipt('targeted-checks',ev);console.error(o.safeError(e));process.exitCode=1;}
