require('./master-offline-guard.cjs');require('reflect-metadata');
const {test}=require('node:test'),assert=require('node:assert/strict');
const {PeopleService}=require('../dist/modules/people/people.service');
const {factoryShiftTarget,factoryShiftWindow}=require('../dist/common/shift-time');
const actor={userId:'reader',role:'MASTER',permissions:['people.read'],selectedFactoryId:'A'};
function row(id,extra={}){return{userId:id,role:'WORKER',user:{id,firstName:'Учебный',lastName:id,employeeState:'AVAILABLE',assignments:[],shiftSessions:[],skills:[],...extra}};}
function service(rows){let query;return{instance:new PeopleService({db:{userFactoryAccess:{findMany:async q=>(query=q,rows)},attachment:{findMany:async()=>[]}}},{},{}),query:()=>query};}
test('AVAILABLE alone is not attendance, current ACTIVE session is; OFF_SHIFT wins',async()=>{
 const s=service([row('empty'),row('arrived',{shiftSessions:[{id:'session'}]}),row('home',{employeeState:'OFF_SHIFT',shiftSessions:[{id:'closed-later'}]})]);
 const all=await s.instance.list(actor);assert.deepEqual(all.people.map(p=>[p.userId,p.onShift]),[['empty',false],['arrived',true],['home',false]]);
 assert.deepEqual((await s.instance.list(actor,{onShift:'true'})).people.map(p=>p.userId),['arrived']);
 assert.deepEqual(s.query().include.user.include.shiftSessions.where,{factoryId:'A',status:'ACTIVE'});
 assert.equal(s.query().include.user.include.assignments.where.factoryId,'A');assert.equal(s.query().include.user.include.assignments.where.endedAt,null);
});
test('current assignment follows existing EmployeeService window and visible-line contract',async()=>{
 const window=factoryShiftWindow(factoryShiftTarget()),line={id:'line',name:'Учебная линия',isActive:true};
 const s=service([row('current',{assignments:[{kind:'LINE',startedAt:window.from,line}]}),row('old',{assignments:[{kind:'LINE',startedAt:new Date(window.from.getTime()-1),line}]}),row('time',{assignments:[{kind:'TIME',startedAt:new Date(0)}]}),row('hidden',{assignments:[{kind:'LINE',startedAt:window.from,line:{...line,name:'test line'}}]})]);
 assert.deepEqual((await s.instance.list(actor)).people.map(p=>[p.userId,p.onShift]),[['current',true],['old',false],['time',true],['hidden',false]]);
 assert.equal(s.query().include.user.include.assignments.where.OR[1].kind,'LINE');
});
test('guest still denied and read-only profile presence derives from same fact helper',async()=>{
 const s=service([]);s.instance.writeDenied=async()=>{};await assert.rejects(s.instance.list({...actor,isGuest:true}),e=>e.status===403);
 assert.equal(s.instance.isOnShift({employeeState:'AVAILABLE',shiftSessions:[]},null),false);
 assert.equal(s.instance.isOnShift({employeeState:'AVAILABLE',shiftSessions:[{id:'s'}]},null),true);
});
test('profile projects current assignment separately; STORE still denies any raw open assignment',async()=>{
 const window=factoryShiftWindow(factoryShiftTarget());let query;
 const target={...row('worker').user,role:'WORKER',factoryAccess:[{role:'WORKER',factoryId:'A',isActive:true,factory:{name:'A'}}],assignments:[{kind:'LINE',startedAt:new Date(0)}]};
 const current={kind:'TIME',startedAt:window.from,timeRoleName:'Учебная помощь'};
 const db={user:{findUnique:async()=>target},assignment:{findFirst:async q=>(query=q,current)},userSkill:{findMany:async()=>[]},attachment:{findFirst:async()=>null}};
 const s=new PeopleService({db},{write:async()=>{}},{});s.visibleNotes=async()=>[];
 const profile=await s.profile(actor,'worker');assert.equal(profile.onShift,true);assert.equal(profile.currentAssignment.kind,'TIME');assert.equal(query.where.factoryId,'A');assert.equal(query.where.userId,'worker');assert.deepEqual(query.orderBy,{startedAt:'desc'});
 await assert.rejects(s.profile({...actor,role:'STORE'},'worker'),e=>e.status===403);
});
