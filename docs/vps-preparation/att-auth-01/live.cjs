const h=require('../factory-01/harness.cjs'),o=require('./own.cjs'),{png}=require('../local-02/files.cjs');
const fid=require('../factory-01/structure.json').factory;
async function identity(p){await o.verify(p);o.assert.equal((await(await fetch('http://127.0.0.1:3000/version')).json()).version,'FACTORY01-20260926-ATTAUTH01');}
async function actor(b,key,width=390){const a=await h.login(b,key,width);a.token=await a.page.evaluate(()=>localStorage.getItem('zavod.authToken'));return a;}
async function raw(a,path,method='GET',body,factory=fid,extra={}){const r=await fetch('http://127.0.0.1:3000'+path,{method,headers:{Authorization:'Bearer '+a.token,'x-factory-id':factory,...(body===undefined?{}:{'Content-Type':'application/json'}),...extra},...(body===undefined?{}:{body:JSON.stringify(body)})});const bytes=Buffer.from(await r.arrayBuffer());let data;try{data=JSON.parse(bytes.toString());}catch{}return{status:r.status,body:data,bytes,sha256:o.sha(bytes)};}
async function upload(a,type,id,op,index=241,factory=fid){const bytes=png(index),form=new FormData();form.append('file',new Blob([bytes],{type:'image/png'}),op+'.png');for(const[k,v]of Object.entries({entityType:type,entityId:id,kind:'PHOTO',operationId:op}))form.append(k,v);const r=await fetch('http://127.0.0.1:3000/attachments/upload',{method:'POST',headers:{Authorization:'Bearer '+a.token,'x-factory-id':factory},body:form});return{status:r.status,body:await r.json(),sha256:o.sha(bytes)};}
const summary=r=>({http:r.status,bytes:r.bytes?.length,sha256:r.sha256});
async function create(a,path,body){const r=await raw(a,path,'POST',body);o.assert.equal(r.status,201,`${path}: ${r.status} ${r.body?.message}`);return r.body;}
module.exports={...h,...o,fid,identity,actor,raw,upload,png,summary,create};
