'use strict';
const {fs,path,assert,crypto,ownRuntime,db,auth,ok,A0,ready}=require('./harness.cjs');
const file=path.join(__dirname,'fixture.json');const ev=fs.existsSync(file)?JSON.parse(fs.readFileSync(file)):{status:'IN_PROGRESS',A0,users:{},steps:[]};
const save=()=>fs.writeFileSync(file,JSON.stringify(ev,null,2));
async function main(){await ready();const p=await db();try{const a=await auth();
 if(!ev.C){assert.equal(await p.factory.count({where:{code:'admin02-c'}}),0);const c=await ok(a,'POST','/admin/factories',{name:'Ограниченная площадка С',code:'admin02-c',template:'EMPTY',description:'Только bounded ADMIN02 fixture; не полноценный испытательный завод'});ev.C=c.id;save();}
 const c={...a,factoryId:ev.C};
 for(const[key,name]of[['department','Смена приёмки'],['otherDepartment','Отдельная служба']])if(!ev[key]){ev[key]=(await ok(c,'POST','/admin/departments',{name,code:`admin02-${key.toLowerCase()}`,scope:'LOCAL',factoryId:ev.C})).id;save();}
 if(!ev.line){ev.line=(await ok(c,'POST','/admin/lines',{name:'Линия приёмки',factoryId:ev.C})).id;save();}
 if(!ev.position){ev.position=(await ok(c,'POST',`/admin/lines/${ev.line}/positions`,{name:'Оператор',displayName:'Оператор',skillCode:'operator'})).id;save();}
 if(!ev.template){ev.template=(await ok(c,'POST',`/admin/lines/${ev.line}/staffing-templates`,{name:'Основной состав',isDefault:true,items:[{positionId:ev.position,requiredCount:1}]})).id;save();}
 if(!ev.currentTemplate){await ok(c,'POST',`/lines/${ev.line}/activate-template`,{staffingTemplateId:ev.template,confirmRemap:true,operationId:'admin02-setup-current-template'});ev.currentTemplate=true;save();}
 for(const[key,kind]of[['area','WORK_AREA'],['timeArea','TIME']])if(!ev[key]){ev[key]=(await ok(c,'POST','/admin/work-areas',{factoryId:ev.C,departmentId:ev.department,name:kind==='TIME'?'Повременная работа':'Рабочая зона',assignmentKind:kind})).id;save();}
 for(const[key,role,firstName,phone]of[['worker','WORKER','Работник','+79990002501'],['master','MASTER','Мастер','+79990002502'],['secondMaster','MASTER','Сменщик','+79990002503'],['peer','MASTER','Другой','+79990002504'],['probe','WORKER','Проверочный','+79990002505']]){
  if(!ev.users[key]){assert.equal(await p.user.count({where:{phone}}),0,'Unknown fixture phone');const f=path.join(ownRuntime(),'secrets',`admin02-${key}.txt`);if(!fs.existsSync(f))fs.writeFileSync(f,`A02!${crypto.randomBytes(24).toString('base64url')}`,{flag:'wx',mode:0o600});const password=fs.readFileSync(f,'utf8').trim();const u=await ok(null,'POST','/auth/register',{phone,password,passwordRepeat:password,operationId:`admin02-register-${key}`},201);ev.users[key]={id:u.userId,phone,role,firstName};save();}
  const u=ev.users[key];if(!u.configured){await ok(a,'POST',`/admin/users/${u.id}/factory-access`,{factoryId:A0,role:role==='WORKER'?'WORKER':'MASTER',isGuest:false,reason:'ADMIN02: bounded own fixture'});
   await ok(c,'POST',`/admin/users/${u.id}/factory-access`,{factoryId:ev.C,role,departmentId:key==='peer'?ev.otherDepartment:ev.department,isGuest:false,reason:'ADMIN02: secondary UFA'});
   await ok(c,'PATCH',`/admin/users/${u.id}/identity`,{lastName:'Приёмочный',firstName,middleName:'Заводович'});u.configured=true;u.name=`Приёмочный ${firstName} Заводович`;save();}
  assert.equal((await p.user.findUnique({where:{id:u.id},select:{factoryId:true}})).factoryId,A0);
 }
 ev.status='PASS_API_SETUP_HOME_A0_SECONDARY_C';ev.atUtc=new Date().toISOString();ev.scope='Own isolated target only; setup uses real auth/register and existing Admin HTTP. Core assignment/return and journal journey still require UI.';save();console.log(JSON.stringify({status:ev.status,C:ev.C,users:Object.keys(ev.users),line:ev.line}));
 }finally{await p.$disconnect();}}
main().catch(e=>{ev.error=e.message;save();console.error(e.message);process.exitCode=1;});
