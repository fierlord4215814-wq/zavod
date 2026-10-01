require('./master-offline-guard.cjs');
const assert=require('node:assert/strict');
const {copy,strict}=require('./master-r2-memory.cjs');
const {UserContextService}=require('../dist/common/user-context.service');
// Relation projection only: the actual UserContextService decides identity/permissions.
function installAuthority(m,accounts,accesses,grants){
  m.data.user=strict({findUnique:async({where,include})=>{
    const row=accounts.find(r=>r.id===where.id);if(!row)return null;if(!include)return copy(row);
    assert.ok(include.factoryAccess);assert.equal(include.factoryAccess.where.isActive,true);
    return {...copy(row),permissionOverrides:copy(row.permissionOverrides??[]),factoryAccess:accesses.filter(a=>a.userId===row.id&&a.isActive&&(!include.factoryAccess.where.factoryId||a.factoryId===include.factoryAccess.where.factoryId)).map(copy)};
  }});
  m.data.rolePermission=strict({findMany:async({where})=>{assert.equal(where.isActive,true);assert.ok(grants[where.role],`UNMOCKED role ${where.role}`);return grants[where.role].map(permissionCode=>({permissionCode}));}});
  const authority=new UserContextService({db:m.db});
  return {authority,resolve:(userId,factoryId)=>withIdentity(()=>authority.resolveForFactory(userId,factoryId))};
}
async function withIdentity(fn){const previous=[process.env.DISABLE_DB,process.env.DEV_MODE];process.env.DISABLE_DB='false';process.env.DEV_MODE='false';try{return await fn();}finally{for(const[i,key]of ['DISABLE_DB','DEV_MODE'].entries())if(previous[i]===undefined)delete process.env[key];else process.env[key]=previous[i];}}
module.exports={installAuthority,withIdentity};
