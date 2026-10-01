const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'../../..'),file=path.join(__dirname,'before.json'),ev=JSON.parse(fs.readFileSync(file));
for(const relative of process.argv.slice(2)){if(ev.files.some(f=>f.path===relative))continue;if(relative.includes('..'))throw Error('Invalid source path');const b=fs.readFileSync(path.join(root,relative)),target=path.join(__dirname,'before',relative);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,b,{flag:'wx'});ev.files.push({path:relative,bytes:b.length,sha256:crypto.createHash('sha256').update(b).digest('hex')});}
fs.writeFileSync(file,JSON.stringify(ev,null,2));console.log(JSON.stringify({sources:ev.files.length}));
