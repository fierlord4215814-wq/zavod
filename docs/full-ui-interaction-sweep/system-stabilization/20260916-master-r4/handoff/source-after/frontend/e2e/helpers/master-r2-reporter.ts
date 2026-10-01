import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';
import type {Reporter,FullConfig,Suite,TestCase,TestResult,FullResult} from '@playwright/test/reporter';
export default class R2Reporter implements Reporter{
 private report:any={startedAt:new Date().toISOString(),expected:[],results:[]};
 private key(t:TestCase){return{title:t.title,file:path.relative(path.resolve(__dirname,'../../..'),t.location.file).replaceAll('\\','/'),line:t.location.line,id:crypto.createHash('sha256').update(t.title).digest('hex').slice(0,12)};}
 onBegin(_c:FullConfig,suite:Suite){this.report.expected=suite.allTests().map(t=>this.key(t));}
 onTestEnd(t:TestCase,r:TestResult){this.report.results.push({...this.key(t),status:r.status,expectedStatus:t.expectedStatus,retry:r.retry,duration:r.duration,errors:r.errors.map(e=>e.message?.slice(0,6000)),attachments:r.attachments.map(a=>({name:a.name,path:a.path,contentType:a.contentType}))});}
 onEnd(result:FullResult){this.report.finishedAt=new Date().toISOString();this.report.status=result.status;this.report.listOnly=this.report.results.length===0;const batch=process.env.MASTER_BATCH;if(!['20260915-master-r2','20260915-master-r3','20260916-master-r4'].includes(batch??''))throw Error('Explicit master report batch required');const target=path.resolve(process.env.R2_BROWSER_REPORT!);const allowed=path.resolve(__dirname,'../../../docs/full-ui-interaction-sweep/system-stabilization',batch!)+path.sep;if(!target.startsWith(allowed)||!target.endsWith('.json'))throw Error('Scoped master browser report required');fs.writeFileSync(target,JSON.stringify(this.report,null,2),{flag:'wx'});}
}
