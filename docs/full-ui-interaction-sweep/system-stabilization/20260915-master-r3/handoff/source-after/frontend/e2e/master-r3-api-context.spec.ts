import {test,expect,Page} from '@playwright/test';
import {buildSync} from 'esbuild';import path from 'node:path';
import {isolate,json,unknown,errors,records,save,installEvidenceHooks} from './helpers/frontend-series';
installEvidenceHooks();let bundle='';
test.beforeAll(()=>{bundle=buildSync({entryPoints:[path.resolve(__dirname,'helpers/master-r3-context.tsx')],bundle:true,write:false,format:'iife',platform:'browser',define:{'import.meta.env.VITE_API_URL':'"/api"','process.env.NODE_ENV':'"production"'},logLevel:'silent'}).outputFiles[0].text;});
async function host(page:Page,kind:string,reply:Parameters<typeof isolate>[1]['replies']){
 await isolate(page,{replies:reply});
 await page.route('**/__api-context.js',r=>r.fulfill({contentType:'text/javascript',body:bundle}));
 await page.route('**/__api-context',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><html lang="ru"><body><div id="root"></div><script src="/__api-context.js"></script></body></html>'}));
 await page.goto('/__api-context#'+kind);
}
for(const kind of ['request','download','upload'])for(const transition of ['Завод А–Б–А','Отозвать право','Выход и повторный вход','Другой пользователь'])test(`R3-C5 actual ${kind} response rejects ${transition}`,async({page})=>{
 let calls=0,release:()=>void=()=>{};const gate=new Promise<void>(resolve=>release=resolve);
 await host(page,kind,async(r,p)=>{if(p!=='/r3/context')return false;calls++;await gate;await json(r,{zero:0,flag:false,empty:''});return true;});
 try{
  await page.getByRole('button',{name:'Начать',exact:true}).click();await expect.poll(()=>calls).toBe(1);await page.getByRole('button',{name:transition,exact:true}).click();release();
  await expect(page.locator('output')).toHaveText(JSON.stringify({delivered:false,error:'ApiContextChangedError'}));expect(calls).toBe(1);expect(unknown).toEqual([]);expect(errors).toEqual([]);
  records.push({kind,transition,actualClient:true,storage:'intercepted network only',reexecution:0});save();
 }finally{release();}
});
test('R3-C5 actual client serialization preserves zero false empty null and omitted undefined',async({page})=>{
 let body:any;
 await host(page,'request',async(r,p)=>{if(p!=='/r3/context')return false;body=r.request().postDataJSON();await json(r,{zero:0,flag:false,empty:'',nothing:null});return true;});
 await page.getByRole('button',{name:'Начать',exact:true}).click();await expect(page.locator('output')).toContainText('"delivered":true');
 expect(body).toEqual({zero:0,flag:false,empty:'',nothing:null,operationId:'r3-stable-key'});expect(JSON.parse(await page.locator('output').innerText()).value).toEqual({zero:0,flag:false,empty:'',nothing:null});
 expect(unknown).toEqual([]);expect(errors).toEqual([]);
});
