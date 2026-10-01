import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {FileBlob,SpreadsheetFile} from '@oai/artifact-tool';
const dir=path.dirname(fileURLToPath(import.meta.url)),root=path.dirname(dir),w=await SpreadsheetFile.importXlsx(await FileBlob.load(path.join(root,'archive-okk.xlsx')));
const summary=await w.inspect({kind:'workbook,sheet,table',maxChars:5000,tableMaxRows:3,tableMaxCols:5}),sheet=w.worksheets.getItem('ОКК'),values=sheet.getUsedRange().values;
const capture=JSON.parse(await fs.readFile(path.join(root,'archive-export.json'),'utf8')),source=capture.source;
const flat=values.flat();for(const[k,v]of Object.entries({productName:source.productName,article:source.article,defectQuantity:source.defectQuantity})){if(!flat.includes(v))throw new Error('Export cell differs from primary '+k);}
const release=w.worksheets.getItem('Частичные выдачи').getUsedRange().values,parameters=w.worksheets.getItem('Параметры').getUsedRange().values;
if(values.length!==2||release.length!==capture.releases.length+1)throw Error('Distinct source/release row counts');
const dateExpected=(Date.parse(source.createdAt)+10800000-Date.UTC(1899,11,30))/86400000;
if(typeof values[1][1]!=='number'||Math.abs(values[1][1]-dateExpected)>1/86400)throw Error('Factory wall-clock typed date differs');
for(let i=0;i<capture.releases.length;i++){const r=capture.releases[i],v=release[i+1];for(const[j,x]of [[5,Number(r.quantity)],[6,r.unit],[7,Number(r.quantityBefore)],[8,Number(r.quantityAfter)]])if(v[j]!==x)throw Error('Typed release quantity/unit mismatch');}
if(parameters.find(x=>x[0]==='Поиск')?.[1]!==source.productName)throw Error('Export search filter differs');
const ev={status:'PASS_PRIMARY_XLSX_READ_ONLY',summary:summary.ndjson,sourceId:source.id,values,release,parameters,typedDate:{actual:values[1][1],expected:dateExpected,toleranceSeconds:1},types:values.map(r=>r.map(x=>x===null?'null':typeof x)),source};await fs.writeFile(path.join(root,'archive-cells.json'),JSON.stringify(ev,null,2));console.log(JSON.stringify({status:ev.status,rows:values.length,columns:values[0]?.length}));
