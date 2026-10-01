// Trusted host preparation only: official public downloads into this named attempt.
// No installer/VM/product/DB execution; no project dependency or global installation changes.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),cp=require('node:child_process');
const dir=__dirname,asset=path.join(dir,'public-metadata');
const hash=(b,algorithm='sha256')=>crypto.createHash(algorithm).update(b).digest(algorithm==='sha512'?'base64':'hex');
const allowed=new Set(['releases.ubuntu.com','keyserver.ubuntu.com','registry.npmjs.org','nodejs.org','ftp.postgresql.org']);
const records=[];
const cachedRecords=fs.readdirSync(dir).filter(n=>/^image-metadata-error(?:-\d+)?\.json$/.test(n)).flatMap(n=>JSON.parse(fs.readFileSync(path.join(dir,n))).records);
const curl=url=>cp.execFileSync('curl.exe',['--ipv4','--proto','=https','--connect-timeout','15','--max-time','45','--fail','--silent','--show-error',url],{windowsHide:true,maxBuffer:12*1024*1024});
async function get(url,name){
 if(!allowed.has(new URL(url).hostname))throw Error('Download host not allowed');
 const cached=path.join(asset,name);
 if(fs.existsSync(cached)){
  const expected=cachedRecords.find(r=>r.url===url&&r.name===name),bytes=fs.readFileSync(cached);
  if(!expected||hash(bytes)!==expected.sha256)throw Error('Unverified cache entry '+name);
  records.push({...expected,reusedVerifiedPriorBytes:true});return bytes;
 }
 const bytes=curl(url);
 fs.mkdirSync(asset,{recursive:true});const dest=path.join(asset,name);
 fs.writeFileSync(dest,bytes,{flag:'wx'});records.push({url,name,bytes:bytes.length,sha256:hash(bytes)});return bytes;
}
(async()=>{
 const pkg=JSON.parse((await get('https://registry.npmjs.org/openpgp/6.2.2','openpgp-6.2.2-metadata.json')).toString());
 if(pkg.name!=='openpgp'||pkg.version!=='6.2.2'||new URL(pkg.dist.tarball).hostname!=='registry.npmjs.org')throw Error('Unexpected verifier package');
 const tgz=await get(pkg.dist.tarball,'openpgp-6.2.2.tgz');
 if('sha512-'+hash(tgz,'sha512')!==pkg.dist.integrity)throw Error('Verifier npm integrity mismatch');
 const members=cp.execFileSync('tar.exe',['-tzf',path.join(asset,'openpgp-6.2.2.tgz')],{encoding:'utf8',windowsHide:true}).split(/\r?\n/).filter(Boolean);
 if(members.some(n=>n.startsWith('/')||n.split('/').includes('..')))throw Error('Unsafe tar member');
 const wanted=['package/dist/node/openpgp.min.cjs','package/LICENSE','package/package.json'];
 for(const n of wanted)if(!members.includes(n))throw Error('Missing verifier member '+n);
 if(fs.existsSync(path.join(asset,wanted[0]))){
  for(const member of wanted){const bytes=cp.execFileSync('tar.exe',['-xOf',path.join(asset,'openpgp-6.2.2.tgz'),member],{windowsHide:true,maxBuffer:10*1024*1024});if(hash(bytes)!==hash(fs.readFileSync(path.join(asset,member))))throw Error('Verifier extracted bytes changed');}
 }else cp.execFileSync('tar.exe',['-xzf',path.join(asset,'openpgp-6.2.2.tgz'),'-C',asset,...wanted],{windowsHide:true});
 const pgp=require(path.join(asset,'package/dist/node/openpgp.min.cjs'));
 const sums=await get('https://releases.ubuntu.com/24.04/SHA256SUMS','ubuntu-SHA256SUMS');
 const sig=await get('https://releases.ubuntu.com/24.04/SHA256SUMS.gpg','ubuntu-SHA256SUMS.gpg');
 const fingerprint='843938df228d22f7b3742bc0d94aa3f0efe21092';
 const curlKey=path.join(asset,'ubuntu-image-public-key-curl.asc');
 const armored=fs.existsSync(curlKey)?fs.readFileSync(curlKey,'utf8'):(await get('https://keyserver.ubuntu.com/pks/lookup?op=get&search=0x'+fingerprint,'ubuntu-image-public-key.asc')).toString();
 if(fs.existsSync(curlKey))records.push({url:'https://keyserver.ubuntu.com/pks/lookup?op=get&search=0xD94AA3F0EFE21092',name:'ubuntu-image-public-key-curl.asc',bytes:fs.statSync(curlKey).size,sha256:hash(fs.readFileSync(curlKey)),transport:'curl IPv4 HTTPS; independently pinned full fingerprint below'});
 const key=await pgp.readKey({armoredKey:armored});if(key.getFingerprint()!==fingerprint)throw Error('Ubuntu signing fingerprint mismatch');
 const signature=sig.subarray(0,15).toString().startsWith('-----BEGIN PGP')?await pgp.readSignature({armoredSignature:sig.toString()}):await pgp.readSignature({binarySignature:sig});
 const verified=await pgp.verify({message:await pgp.createMessage({binary:sums}),signature,verificationKeys:key});
 const outcomes=[];for(const s of verified.signatures){try{await s.verified;outcomes.push({keyId:s.keyID.toHex(),verified:true});}catch(e){outcomes.push({keyId:s.keyID.toHex(),verified:false,error:e.message});}}
 if(!outcomes.some(s=>s.verified))throw Error('No verified Ubuntu checksum signature');
 const filename='ubuntu-24.04.5-live-server-amd64.iso';
 const match=sums.toString().split(/\r?\n/).find(s=>s.endsWith('*'+filename)||s.endsWith('  '+filename));
 if(!match)throw Error('Pinned Ubuntu Server image missing from signed checksum');
 const headers=cp.execFileSync('curl.exe',['--ipv4','--proto','=https','--head','--connect-timeout','15','--max-time','45','--fail','--silent','--show-error','https://releases.ubuntu.com/24.04/'+filename],{encoding:'utf8',windowsHide:true});
 if(!/HTTP\/\S+ 200\b/.test(headers))throw Error('ISO HEAD not 200');
 fs.writeFileSync(path.join(asset,'ubuntu-iso-headers.txt'),headers,{flag:'wx'});
 const node=(await get('https://nodejs.org/dist/v24.15.0/SHASUMS256.txt','node24.15.0-SHASUMS256.txt')).toString().split(/\r?\n/).find(s=>s.endsWith('node-v24.15.0-linux-x64.tar.xz'));
 if(!node)throw Error('Pinned Node Linux binary missing');
 const postgres=await get('https://ftp.postgresql.org/pub/source/v18.3/postgresql-18.3.tar.bz2.sha256','postgresql18.3.sha256');
 const result={at:new Date().toISOString(),status:'OFFICIAL_METADATA_VERIFIED_IMAGE_NOT_DOWNLOADED',ubuntu:{filename,url:'https://releases.ubuntu.com/24.04/'+filename,sha256:match.slice(0,64),bytes:Number(headers.match(/^content-length:\s*(\d+)/im)?.[1])||null,signingKeyFingerprint:fingerprint,signatures:outcomes},node:{version:'24.15.0',checksumLine:node},postgresql:{version:'18.3',sourceChecksum:postgres.toString().trim(),sourceOnlyNotWorkingInstallation:true},verifier:{name:pkg.name,version:pkg.version,license:pkg.license,npmIntegrity:pkg.dist.integrity},records};
 fs.writeFileSync(path.join(dir,'image-metadata-verification.json'),JSON.stringify(result,null,2),{flag:'wx'});console.log(JSON.stringify(result));
})().catch(e=>{const result={at:new Date().toISOString(),status:'METADATA_PREPARATION_FAILED',error:e.message,cause:e.cause?{code:e.cause.code,message:e.cause.message}:null,records};let name='image-metadata-error.json',n=1;while(fs.existsSync(path.join(dir,name)))name='image-metadata-error-'+(++n)+'.json';fs.writeFileSync(path.join(dir,name),JSON.stringify(result,null,2),{flag:'wx'});console.error(JSON.stringify(result));process.exitCode=1;});
