// Build a factual pre-install receipt from observed metadata; no system mutation.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const dir=__dirname,root=path.resolve(dir,'../../../../../..');
const read=n=>JSON.parse(fs.readFileSync(path.join(dir,n),'utf8').replace(/^\uFEFF/,''));
const sha=n=>crypto.createHash('sha256').update(fs.readFileSync(path.join(dir,n))).digest('hex');
const h=read('host-inventory.json'),m=read('image-metadata-verification.json'),b=read('baseline.json');
const gib=1024**3,vmGiB=16;
const requiredDiskBytes=(10+2+vmGiB+4+0.25+1)*gib+m.ubuntu.bytes;
const checks={edition:h.windows.EditionID==='Professional',x64:h.cpu.AddressWidth===64,virtualization:h.cpu.VirtualizationFirmwareEnabled===true,slat:h.cpu.SecondLevelAddressTranslationExtensions===true,monitor:h.cpu.VMMonitorModeExtensions===true,dep:h.os.DataExecutionPrevention_Available===true,freeRam:Number(h.os.FreePhysicalMemory)*1024>=6*gib,disk:Number(h.disk.FreeSpace)>=requiredDiskBytes,ubuntuSignature:m.ubuntu.signatures.some(s=>s.verified),imageSized:m.ubuntu.bytes>0,baselineUnchanged:b.groups.every(g=>g.files.every(f=>f.unchanged))&&b.matrices.every(f=>f.unchanged)&&b.retained.every(f=>f.unchanged)&&b.priorZip.matches};
if(Object.values(checks).some(v=>!v))throw Error('Preflight failed: '+JSON.stringify(checks));
const lock=JSON.parse(fs.readFileSync(path.join(root,'package-lock.json')));
const result={at:new Date().toISOString(),status:'PLATFORM_COMPATIBILITY_READY_FOR_STANDARD_UAC_NOT_RUNTIME_PROOF',checks,
  evidence:['host-inventory.json','image-metadata-verification.json','baseline.json','compatibility-and-budget.md'].map(name=>({name,sha256:sha(name)})),
  chosenMechanism:'Hyper-V',guest:'Ubuntu Server 24.04 LTS amd64',toolchain:{node:process.version,prisma:lock.packages['backend/node_modules/prisma'].version,prismaClient:lock.packages['backend/node_modules/@prisma/client'].version,playwright:lock.packages['node_modules/playwright'].version,postgresql:m.postgresql.version},
  resources:{vcpu:2,ramBytes:4*gib,dynamicVhdxMaximumBytes:vmGiB*gib,minimumFreeRamBeforeVmBytes:6*gib,minimumHostHeadroomBytes:10*gib,minimumFreeDiskBeforeInstallBytes:requiredDiskBytes,observedFreeDiskBytes:Number(h.disk.FreeSpace),budgetedRemainingBytes:Number(h.disk.FreeSpace)-(requiredDiskBytes-10*gib),imageBytes:m.ubuntu.bytes},
  systemWrite:'Enable-WindowsOptionalFeature -Online -FeatureName Microsoft-Hyper-V,Microsoft-Hyper-V-Management-PowerShell -All -NoRestart',
  protectedHistoricalSandboxAttemptRetained:true,workingDbAccessed:false,vmCreated:false,actualStack:'NOT_RUN',isolationProof:'NOT_RUN',transferRoundTrip:'NOT_RUN_MUST_PRECEDE_LONG_TESTS',automaticHostReboot:false};
fs.writeFileSync(path.join(dir,'preflight.json'),JSON.stringify(result,null,2),{flag:'wx'});
console.log(JSON.stringify({status:result.status,checks,resources:result.resources,toolchain:result.toolchain}));
