// Current-source contract index; counters are not claims of exercised controls.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),ts=require('typescript');
const root=path.resolve(__dirname,'../../../..');
const sha=data=>crypto.createHash('sha256').update(data).digest('hex');
const rel=file=>path.relative(root,file).replaceAll('\\','/');
const walk=dir=>fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(dir,e.name)):[path.join(dir,e.name)]);
const files=[...walk(path.join(root,'frontend/src')),...walk(path.join(root,'backend/src'))].filter(f=>/\.(tsx?|js)$/.test(f));
const moduleOf=owner=>{const m=owner.match(/backend\/src\/modules\/([^/]+)/);if(m)return 'backend:'+m[1];if(owner.includes('backend/src/common'))return 'backend:identity-audit-common';if(owner.includes('backend/src/ws'))return 'backend:ws';if(owner.includes('backend/src/prisma'))return 'backend:infrastructure';const s=owner.match(/frontend\/src\/screens\/(.*)Screen/);return s?'frontend:'+s[1]:owner.endsWith('/App.tsx')?'frontend:Shell':'frontend:shared';};
const decorators=n=>ts.canHaveDecorators(n)?ts.getDecorators(n)||[]:[];
const metadata=(n,name)=>decorators(n).map(d=>d.expression).filter(e=>ts.isCallExpression(e)&&e.expression.getText()===name).flatMap(e=>e.arguments.map(a=>a.getText()));
const nodes=[],routes=[],edges=[],modals=[],media=[];
for(const file of files){
  const owner=rel(file),body=fs.readFileSync(file,'utf8'),ast=ts.createSourceFile(file,body,ts.ScriptTarget.Latest,true),imports=new Map(),injections=new Map(),module=moduleOf(owner);
  for(const node of ast.statements)if(ts.isImportDeclaration(node)&&ts.isStringLiteral(node.moduleSpecifier)){
    const targetBase=path.resolve(path.dirname(file),node.moduleSpecifier.text),target=['.ts','.tsx','.js','/index.ts'].map(s=>targetBase+s).find(f=>fs.existsSync(f));
    for(const el of node.importClause?.namedBindings?.elements||[])if(target)imports.set(el.name.text,rel(target));
  }
  const nodeRecord={owner,module,sha256:sha(body),methods:[]};nodes.push(nodeRecord);
  function visit(n,scope='module'){
    const line=ast.getLineAndCharacterOfPosition(n.getStart()).line+1;
    if(ts.isMethodDeclaration(n)||ts.isFunctionDeclaration(n))scope=n.name?.getText(ast)||scope;
    if(ts.isConstructorDeclaration(n))for(const p of n.parameters)if(p.type&&imports.has(p.type.getText(ast)))injections.set(p.name.getText(ast),imports.get(p.type.getText(ast)));
    if(ts.isClassDeclaration(n)){
      const isController=decorators(n).some(d=>ts.isCallExpression(d.expression)&&d.expression.expression.getText(ast)==='Controller');
      const prefix=metadata(n,'Controller')[0]?.replace(/^['"]|['"]$/g,'')||'';
      if(isController)for(const method of n.members)if(ts.isMethodDeclaration(method)){
        for(const verb of ['Get','Post','Put','Patch','Delete'])for(const expression of decorators(method).map(d=>d.expression).filter(e=>ts.isCallExpression(e)&&e.expression.getText(ast)===verb)){
          const suffix=expression.arguments[0]?.getText(ast).replace(/^['"]|['"]$/g,'')||'';
          routes.push({id:sha(`${owner}|${method.name.getText(ast)}|${verb}`).slice(0,16),owner,module,method:method.name.getText(ast),verb:verb.toUpperCase(),path:'/'+[prefix,suffix].filter(Boolean).join('/'),permissions:metadata(method,'RequirePermission'),classPermissions:metadata(n,'RequirePermission'),signature:method.parameters.map(p=>p.getText(ast)).join(', '),handler:method.body?.getText(ast).slice(0,1100),line:ast.getLineAndCharacterOfPosition(method.getStart()).line+1,status:'STATIC_ONLY_NOT_HTTP_PIPELINE'});
        }
      }
    }
    if(ts.isCallExpression(n)){
      const fn=n.expression.getText(ast),injected=fn.match(/^this\.(\w+)\.(\w+)$/),api=/^apiClient\./.test(fn),event=/dispatchEvent$|\.emit$|\.publish$|sendToUsers$/.test(fn);
      if(api||event||(injected&&injections.has(injected[1])))edges.push({id:sha(`${owner}|${scope}|${fn}|${n.arguments.map(a=>a.getText(ast)).join('|')}`).slice(0,16),source:module,owner,scope,line,kind:api?'API':event?'EVENT':'SERVICE_CALL',targetOwner:injected?injections.get(injected[1])||null:null,call:fn,arguments:n.arguments.map(a=>a.getText(ast).slice(0,750)),status:'STATIC_ONLY',proof:'Current source call trace only; not data-flow/runtime acceptance',context:'Handler/source owner and controller metadata; no inferred extra authority'});
    }
    if(ts.isJsxOpeningElement(n)||ts.isJsxSelfClosingElement(n)){
      const name=n.tagName.getText(ast),attributes=n.attributes.getText(ast);
      if(name==='ActionModal')modals.push({id:sha(`${owner}|${attributes}`).slice(0,16),owner,line,attributes,typesInOwner:[...new Set([...body.matchAll(/type:\s*['"](text|number|textarea|checkbox|select|date|datetime-local)['"]/g)].map(m=>m[1]))],dirty:attributes.includes('dirty='),busy:attributes.includes('busy='),children:ts.isJsxOpeningElement(n),proof:'SOURCE_VARIANT_INVENTORY; family tests require explicit linkage'});
      if(name==='AttachmentPreviewList')media.push({owner,line,attributes});
    }
    ts.forEachChild(n,child=>visit(child,scope));
  }visit(ast);
}
for(const e of edges){
  if(e.targetOwner)e.target=moduleOf(e.targetOwner);
  else if(e.kind==='API'){
    const text=e.arguments[0]||'',literal=text.match(/^[`'"]([^?$`'"]+)/)?.[1]||'';
    const candidates=routes.filter(r=>r.path.split('/')[1]===literal.split('/')[1]);
    e.targetModules=[...new Set(candidates.map(r=>r.module))];e.controllerCandidates=candidates.map(r=>r.id);
  }
}
const backendModules=fs.readdirSync(path.join(root,'backend/src/modules'),{withFileTypes:true}).filter(e=>e.isDirectory()).map(e=>e.name);
const adminSource=fs.readFileSync(path.join(root,'frontend/src/screens/AdminConfigScreen.tsx'),'utf8');
const inventory={time:new Date().toISOString(),modules:{backend:backendModules,frontend:[...new Set(nodes.map(n=>n.module).filter(n=>n.startsWith('frontend:')))],scope:'26 backend feature modules plus shared infrastructure; frontend screen owners mapped, not 26 independent business systems'},sourceFingerprint:sha(JSON.stringify(nodes.map(n=>({owner:n.owner,sha256:n.sha256})))),nodes,routes,edges,modals,media,limits:['Static edge discovery is not verified integration','Repeated call sites retain source scope; no click/screenshot counters','Backend controller decorators are metadata, not live guards/HTTP stack','Admin subsection detail in current source and parent surface inventory']};
const name=process.argv[2]||'module-and-edge-inventory.json';fs.writeFileSync(path.join(__dirname,name),JSON.stringify(inventory,null,2),{flag:'wx'});
console.log(JSON.stringify({backendModules:backendModules.length,frontendOwners:inventory.modules.frontend.length,routes:routes.length,edges:edges.length,uniqueEdgeKeys:new Set(edges.map(e=>e.id)).size,modalInstances:modals.length,previewInstances:media.length,sourceFingerprint:inventory.sourceFingerprint},null,2));
