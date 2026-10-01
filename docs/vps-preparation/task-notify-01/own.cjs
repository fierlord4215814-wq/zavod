const o=require('../factory-01/own-runtime.cjs');
const name='zavod_factory01_task_notify',dest=o.path.join(o.runtime,'tasknotify');
function url(){return `postgresql://factory01_owner:${encodeURIComponent(o.secret('db-password'))}@127.0.0.1:15437/${name}?schema=public`;}
function prisma(){const{PrismaClient}=require(o.path.join(o.root,'backend/node_modules/@prisma/client'));return new PrismaClient({datasources:{db:{url:url()}}});}
const receipt=(n,d)=>o.fs.writeFileSync(o.path.join(__dirname,n+'.json'),JSON.stringify(d,null,2));
module.exports={...o,name,dest,url,prisma,verify:p=>o.verify(p,name),receipt};
