// Finite AST index of the existing ProcessedOperation readers, not another whole-system sweep.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),ts=require('../../../../node_modules/typescript');
const root=path.resolve(__dirname,'../../../..');
const files=fs.readdirSync(path.join(root,'backend/src/modules'),{withFileTypes:true}).filter(e=>e.isDirectory()).flatMap(e=>fs.readdirSync(path.join(root,'backend/src/modules',e.name)).filter(n=>n.endsWith('.service.ts')).map(n=>`backend/src/modules/${e.name}/${n}`));
const rows=[];
for(const owner of files){const source=fs.readFileSync(path.join(root,owner),'utf8'),ast=ts.createSourceFile(owner,source,ts.ScriptTarget.Latest,true);for(const c of ast.statements.filter(ts.isClassDeclaration))for(const m of c.members.filter(ts.isMethodDeclaration)){
  if(!m.body)continue;const body=m.body.getText(ast),method=m.name.getText(ast);
  if(!/processedOperation\.find|this\.(findProcessedCreate|processedMembershipReplayTx)\(/.test(body))continue;
  rows.push({id:`${c.name.text}.${method}`,owner,line:ast.getLineAndCharacterOfPosition(m.getStart(ast)).line+1,methodSha256:crypto.createHash('sha256').update(m.getText(ast)).digest('hex'),processedRead:/processedOperation\.find/.test(body),helperCall:/this\.(findProcessedCreate|processedMembershipReplayTx)\(/.test(body),resultKey:/\.resultKey/.test(body),status:'STATIC_ENUMERATED_NOT_BLANKET_VERIFIED'});
}}
const out=path.join(__dirname,process.argv[2]||'replay-census.json');fs.writeFileSync(out,JSON.stringify({count:rows.length,scope:'existing ProcessedOperation read methods + immediate create/membership callers; distinct direct operationId stores are supplemental, not denominator inflation',rows},null,2),{flag:'wx'});console.log(JSON.stringify(rows.map(r=>({id:r.id,line:r.line,resultKey:r.resultKey,helper:r.helperCall})),null,2));
