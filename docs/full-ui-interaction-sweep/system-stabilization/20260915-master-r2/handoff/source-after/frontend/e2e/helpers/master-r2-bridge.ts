import {fork} from 'node:child_process';
import path from 'node:path';
export function serviceBridge(mode:'publication'|'handover'){
  const child=fork(path.resolve(__dirname,'../../../backend/scripts/master-r2-service-bridge.cjs'),[mode],{silent:true,windowsHide:true});
  let sequence=0;const pending=new Map<number,{resolve:(x:any)=>void,reject:(e:Error)=>void}>(),traffic:any[]=[];let stderr='';child.stderr?.on('data',b=>stderr+=b.toString());
  child.on('message',(reply:any)=>{const p=pending.get(reply.id);if(!p)return;pending.delete(reply.id);traffic.push({direction:'reply',...reply});p.resolve(reply);});
  child.on('exit',code=>{for(const p of pending.values())p.reject(Error(`IPC exited ${code}: ${stderr}`));pending.clear();});
  const rpc=(input:any)=>new Promise<any>((resolve,reject)=>{const id=++sequence;traffic.push({direction:'request',id,...input});pending.set(id,{resolve,reject});child.send({...input,id});});
  const close=()=>new Promise<void>(resolve=>{if(child.exitCode!==null)return resolve();child.once('exit',()=>resolve());child.disconnect();});
  return {rpc,close,traffic,pid:child.pid};
}
