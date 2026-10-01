const h=require('../factory-01/harness.cjs'),o=require('./own.cjs');
const fid='e3d1c2ce-f596-461d-9c97-705d176cc25a';
async function identity(p){await o.verify(p);const v=await(await fetch('http://127.0.0.1:3000/version')).json();o.assert.equal(v.version,'FACTORY01-20260926-OPS01');o.assert.equal(await p.pushSubscription.count(),0);return{version:v.version,database:o.name,factory:fid};}
async function actor(browser,key='ADMIN',width=390){const a=await h.login(browser,key,width);a.token=await a.page.evaluate(()=>localStorage.getItem('zavod.authToken'));return a;}
async function raw(a,route,method='GET',body,factory=fid,extra={}){const r=await fetch('http://127.0.0.1:3000'+route,{method,headers:{Authorization:'Bearer '+a.token,'x-factory-id':factory,...(body===undefined?{}:{'Content-Type':'application/json'}),...extra},...(body===undefined?{}:{body:JSON.stringify(body)})});const bytes=Buffer.from(await r.arrayBuffer());let value;try{value=JSON.parse(bytes.toString())}catch{}return{status:r.status,body:value,bytes:bytes.length,sha256:o.sha(bytes)};}
module.exports={...h,...o,fid,identity,actor,raw};
