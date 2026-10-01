import { test, expect, Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { buildSync } from 'esbuild';
import { isolate, json, errors, unknown, network, records, save, shot, installEvidenceHooks } from './helpers/frontend-series';
installEvidenceHooks();
let code='';
test.beforeAll(()=>{
  code=buildSync({entryPoints:[path.resolve(__dirname,'helpers/components.tsx')],bundle:true,write:false,format:'iife',platform:'browser',define:{'import.meta.env.VITE_API_URL':'"/api"','process.env.NODE_ENV':'"production"'},logLevel:'silent'}).outputFiles[0].text;
});
async function host(page:Page,kind='media',replies?:Parameters<typeof isolate>[1]['replies']){
  await isolate(page,{replies});
  const css=fs.readdirSync(path.resolve(__dirname,'../dist/assets')).find(f=>f.endsWith('.css'))!;
  await page.route('**/__component.js',r=>r.fulfill({contentType:'text/javascript',body:code}));
  await page.route('**/__component',r=>r.fulfill({contentType:'text/html',body:`<!doctype html><html lang="ru"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/assets/${css}"></head><body><div id="root"></div><script src="/__component.js"></script></body></html>`}));
  await page.goto('/__component#'+kind);
  records.push({host:'real-owner-component-bundle',sha256:crypto.createHash('sha256').update(code).digest('hex'),notProductionShell:true});save();
}
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64');
test('R2-F form same-name text textarea replacement preserves edited and pristine baseline',async({page})=>{
 await host(page,'form');await page.getByRole('button',{name:'Тип поля',exact:true}).click();await expect(page.locator('textarea[name=text]')).toHaveValue('');await page.getByRole('button',{name:'Отмена',exact:true}).click();await expect(page.getByRole('dialog')).toBeHidden();
 await page.getByRole('button',{name:'Открыть форму',exact:true}).click();await page.getByLabel('Название',{exact:true}).fill('Проверить датчик');await page.getByRole('button',{name:'Тип поля',exact:true}).click();await expect(page.locator('input[name=text]')).toHaveValue('Проверить датчик');await page.getByRole('button',{name:'Поздние defaults',exact:true}).click();await expect(page.getByLabel('Название',{exact:true})).toHaveValue('Проверить датчик');await page.getByRole('button',{name:'Отмена',exact:true}).click();await expect(page.getByText('Изменения не сохранены',{exact:true})).toBeVisible();await page.getByRole('button',{name:'Остаться',exact:true}).click();await page.getByRole('button',{name:'Подтвердить',exact:true}).click();expect(JSON.parse(await page.locator('output').innerText()).text).toBe('Проверить датчик');expect(errors).toEqual([]);expect(unknown).toEqual([]);
});
test('R2-F form option removal restoration preserves identity and seven typed empty zero false values',async({page})=>{
 await host(page,'form');await page.getByLabel('Получатель',{exact:true}).selectOption('two');await page.getByRole('button',{name:'Наличие варианта',exact:true}).click();await expect(page.getByLabel('Получатель',{exact:true}).locator('option[value=two]')).toHaveCount(0);
 // No submission while option is absent: policy for permanent removal is not invented by this host.
 await page.getByRole('button',{name:'Наличие варианта',exact:true}).click();await expect(page.getByLabel('Получатель',{exact:true})).toHaveValue('two');await page.getByRole('button',{name:'Подтвердить',exact:true}).click();expect(JSON.parse(await page.locator('output').innerText())).toEqual({text:'',number:'0',enabled:false,choice:'two',date:'2026-09-15',time:'2026-09-15T20:00',comment:''});
  await page.getByLabel('Количество',{exact:true}).fill('9');await page.getByLabel('Количество',{exact:true}).fill('0');await page.getByLabel('Включено',{exact:true}).check();await page.getByLabel('Включено',{exact:true}).uncheck();await page.getByLabel('Получатель',{exact:true}).selectOption('');await page.getByLabel('Получатель',{exact:true}).blur();await page.getByRole('button',{name:'Отмена',exact:true}).click();await expect(page.getByRole('dialog')).toBeHidden();expect(errors).toEqual([]);expect(unknown).toEqual([]);
});
test('Master 060 distinct images audio video document and four view modes share bounded resources',async({page})=>{
  const video=Buffer.from(await page.evaluate(async()=>{
    // Synthetic canvas stream only: no camera/microphone/device access.
    const canvas=document.createElement('canvas');canvas.width=32;canvas.height=32;const context=canvas.getContext('2d')!;const stream=canvas.captureStream(10);
    const recorder=new MediaRecorder(stream,{mimeType:'video/webm;codecs=vp8'});const chunks:Blob[]=[];recorder.ondataavailable=e=>chunks.push(e.data);
    const done=new Promise<void>(resolve=>recorder.onstop=()=>resolve());recorder.start();for(let frame=0;frame<6;frame++){context.fillStyle=frame%2?'#53687a':'#526779';context.fillRect(0,0,32,32);await new Promise(r=>setTimeout(r,100));}recorder.stop();await done;stream.getTracks().forEach(t=>t.stop());return Array.from(new Uint8Array(await new Blob(chunks).arrayBuffer()));
  }));
  const audio=Buffer.alloc(8044,128);audio.write('RIFF',0);audio.writeUInt32LE(8036,4);audio.write('WAVEfmt ',8);audio.writeUInt32LE(16,16);audio.writeUInt16LE(1,20);audio.writeUInt16LE(1,22);audio.writeUInt32LE(8000,24);audio.writeUInt32LE(8000,28);audio.writeUInt16LE(1,32);audio.writeUInt16LE(8,34);audio.write('data',36);audio.writeUInt32LE(8000,40);
  const calls:Record<string,number>={};
  await host(page,'gallery',async(r,p)=>{
    const m=p.match(/^\/attachments\/(component-image|component-second-image|component-audio|component-video|component-document)\/file$/);if(!m)return false;const id=m[1];calls[id]=(calls[id]||0)+1;
    await r.fulfill({contentType:id.includes('audio')?'audio/wav':id.includes('video')?'video/webm':id.includes('document')?'text/plain':'image/png',body:id.includes('audio')?audio:id.includes('video')?video:id.includes('document')?Buffer.from('Инструкция: проверьте защиту оборудования.'):png});return true;
  });
  await expect.poll(()=>Object.keys(calls).length).toBe(4);expect(calls['component-document']).toBeUndefined();
  for(const mode of ['grid','inline','focus']){await page.getByLabel('Режим',{exact:true}).selectOption(mode);await expect(page.locator('.attachment-preview-block')).toHaveClass(new RegExp(`attachment-preview-${mode}`));}
  await page.getByRole('button',{name:'Открыть фото 1 из 2',exact:true}).click();await expect(page.locator('.attachment-large-preview')).toBeVisible();await page.getByRole('button',{name:'Следующее фото',exact:true}).click();await expect(page.locator('.attachment-viewer-counter')).toHaveText('2 из 2');await page.getByRole('button',{name:'Увеличить фото',exact:true}).click();await page.goBack();
  await page.getByLabel('Режим',{exact:true}).selectOption('list');await page.locator('.attachment-preview.video').getByRole('button',{name:'Открыть',exact:true}).click();
  try{await expect.poll(()=>page.locator('video.attachment-large-preview').evaluate((e:HTMLVideoElement)=>e.readyState)).toBeGreaterThanOrEqual(1);}finally{records.push({videoFixtureBytes:video.length,header:video.subarray(0,16).toString('hex'),video:await page.locator('video.attachment-large-preview').evaluate((e:HTMLVideoElement)=>({ready:e.readyState,network:e.networkState,error:e.error?{code:e.error.code,message:e.error.message}:null,src:e.currentSrc}))});save();}await page.goBack();
  await page.locator('.attachment-preview').filter({hasText:'Комментарий.wav'}).getByRole('button',{name:'Открыть',exact:true}).click();await expect.poll(()=>page.locator('audio').evaluate((e:HTMLAudioElement)=>e.readyState)).toBeGreaterThanOrEqual(1);await page.goBack();
  await page.locator('.attachment-preview').filter({hasText:'Инструкция.txt'}).getByRole('button',{name:'Открыть',exact:true}).click();await expect(page.getByRole('dialog')).toContainText('Предпросмотр недоступен для этого типа');await expect(page.getByRole('link',{name:'Скачать/открыть',exact:true})).toHaveAttribute('href',/^blob:/);await shot(page,'060-four-media-document',{state:'synthetic-memory-media-codec-not-physical'});await page.goBack();
  expect(Object.values(calls)).toEqual([1,1,1,1,1]);expect(unknown).toEqual([]);expect(errors).toEqual([]);
});
test('Master 060 pending concurrent consumers share one request and last release owns URL',async({page})=>{
  let release:()=>void=()=>{},pending=0;const wait=new Promise<void>(resolve=>release=resolve);
  await page.addInitScript(()=>{
    const originalCreate=URL.createObjectURL,originalRevoke=URL.revokeObjectURL;
    (window as any).urlEvents=[];
    URL.createObjectURL=function(blob){const result=originalCreate.call(URL,blob);(window as any).urlEvents.push({kind:'create',url:result});return result;};
    URL.revokeObjectURL=function(url){(window as any).urlEvents.push({kind:'revoke',url});return originalRevoke.call(URL,url);};
  });
  await host(page,'media',async(r,p)=>{if(p==='/attachments/component-image/file'){pending++;await wait;await r.fulfill({contentType:'image/png',body:png});return true;}return false;});
  await expect.poll(()=>pending).toBeGreaterThan(0);await page.getByRole('button',{name:'Повторный render',exact:true}).click();
  await shot(page,'060-pending-concurrent',{pending});
  try{expect(pending).toBe(1);}finally{release();}
  await expect(page.locator('[data-testid=first] img')).toBeVisible();await expect(page.locator('[data-testid=second] img')).toBeVisible();
  const urls=await page.locator('img').evaluateAll(imgs=>imgs.map(i=>(i as HTMLImageElement).src));expect(new Set(urls).size).toBe(1);
  await page.getByRole('button',{name:'Первый consumer',exact:true}).click();
  expect(await page.evaluate(()=>(window as any).urlEvents.filter(e=>e.kind==='revoke').length)).toBe(0);
  await page.getByRole('button',{name:'Второй consumer',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>(window as any).urlEvents.filter(e=>e.kind==='revoke').length)).toBe(1);
  expect(unknown).toEqual([]);expect(errors).toEqual([]);
});
test('Master 047 edited conditional field retains draft and dirty guard across hide show',async({page})=>{
  await host(page,'form');await page.getByLabel('Комментарий',{exact:true}).fill('Не потерять замечание');
  await page.getByRole('button',{name:'Условное поле',exact:true}).click();
  await page.getByRole('button',{name:'Отмена',exact:true}).click();
  await shot(page,'047-conditional-field-dirty');
  await expect(page.getByText('Изменения не сохранены',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Остаться',exact:true}).click();
  await page.getByRole('button',{name:'Условное поле',exact:true}).click();
  await expect(page.getByLabel('Комментарий',{exact:true})).toHaveValue('Не потерять замечание');
  expect(unknown).toEqual([]);expect(errors).toEqual([]);
});

test('Master 060 denied retry context change and logout are isolated',async({page})=>{
  let status=403,calls=0;
  await host(page,'media',async(r,p)=>{if(p==='/attachments/component-image/file'){calls++;await r.fulfill(status===200?{contentType:'image/png',body:png}:{status,contentType:'application/json',body:JSON.stringify({message:'storagePath SECRET_INTERNAL_SHOULD_NOT_DISPLAY'})});return true;}return false;});
  await expect(page.locator('[data-testid=first]')).toContainText('Нет прав для просмотра.');
  const deniedCalls=calls;status=200;
  await page.locator('[data-testid=first]').getByRole('button',{name:'Открыть',exact:true}).click();
  await expect(page.locator('.attachment-large-preview')).toBeVisible();expect(calls).toBe(deniedCalls+1);
  await page.goBack();await page.getByRole('button',{name:'Другой контекст',exact:true}).click();
  await expect(page.locator('img')).toHaveCount(0);
  await page.locator('[data-testid=second]').getByRole('button',{name:'Открыть',exact:true}).click();
  await expect(page.locator('.attachment-large-preview')).toBeVisible();
  expect(network.filter(r=>r.path==='/attachments/component-image/file').at(-1).factory).toBe('component-second');
  await page.goBack();await page.getByRole('button',{name:'Выход из контекста',exact:true}).click();
  await expect(page.locator('img')).toHaveCount(0);expect(await page.locator('body').innerText()).not.toContain('SECRET_INTERNAL');
  expect(unknown).toEqual([]);expect(errors).toEqual([]);
});

test('Master 060 pending Back and unmount do not recreate protected URL or reopen layer',async({page})=>{
  let release:()=>void=()=>{},calls=0;const wait=new Promise<void>(resolve=>release=resolve);
  await page.addInitScript(()=>{(window as any).created=0;const create=URL.createObjectURL;URL.createObjectURL=function(b){(window as any).created++;return create(b);};});
  await host(page,'media',async(r,p)=>{if(p==='/attachments/component-image/file'){calls++;await wait;await r.fulfill({contentType:'image/png',body:png}).catch(()=>{});return true;}return false;});
  await page.locator('[data-testid=first]').getByRole('button',{name:'Открыть',exact:true}).click();await expect(page.getByRole('dialog')).toContainText('Загрузка файла');
  await page.goBack();await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button',{name:'Первый consumer',exact:true}).click();await page.getByRole('button',{name:'Второй consumer',exact:true}).click();release();
  await page.evaluate(()=>new Promise<void>(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r()))));
  expect(calls).toBe(1);expect(await page.evaluate(()=>(window as any).created)).toBe(0);await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(unknown).toEqual([]);expect(errors).toEqual([]);
});

test('Master 060 timeout and 404 allow one fresh retry after failure',async({page})=>{
  let status=404,calls=0,release:()=>void=()=>{};
  await page.clock.install();
  await host(page,'media',async(r,p)=>{if(p==='/attachments/component-image/file'){calls++;if(status===0)await new Promise<void>(resolve=>release=resolve);await r.fulfill(status===200?{contentType:'image/png',body:png}:{status:404,body:''}).catch(()=>{});return true;}return false;});
  await expect(page.locator('[data-testid=first]')).toContainText('Файл отсутствует в хранилище');const before=calls;
  status=0;await page.locator('[data-testid=first]').getByRole('button',{name:'Открыть',exact:true}).click();await expect.poll(()=>calls).toBe(before+1);
  await page.clock.fastForward(31000);await expect(page.getByRole('dialog')).toContainText('превышено время ожидания');await page.goBack();release();status=200;
  await page.locator('[data-testid=first]').getByRole('button',{name:'Открыть',exact:true}).click();await expect(page.locator('.attachment-large-preview')).toBeVisible();expect(calls).toBe(before+2);
  expect(unknown).toEqual([]);expect(errors).toEqual([]);
});

test('Master 047 child dirty file chooser cancellation and reordered fields preserve draft',async({page})=>{
  await host(page,'form');await page.getByLabel('Комментарий',{exact:true}).fill('Порядок не меняет смысл');await page.getByRole('button',{name:'Порядок полей',exact:true}).click();
  await expect(page.getByLabel('Комментарий',{exact:true})).toHaveValue('Порядок не меняет смысл');await page.getByRole('button',{name:'Подтвердить',exact:true}).click();await expect(page.locator('output')).toContainText('Порядок не меняет смысл');
  await page.goto('/__component#children');await page.reload();await page.getByLabel('Текст дочернего поля').fill('Заметка к пункту');
  const camera=page.locator('input[type=file][capture]');await expect(camera).toHaveAttribute('accept','image/*');await expect(camera).toHaveAttribute('capture','environment');
  await camera.dispatchEvent('cancel');await expect(page.getByLabel('Текст дочернего поля')).toHaveValue('Заметка к пункту');
  await page.locator('input[type=file]').nth(1).setInputFiles({name:'Фото.png',mimeType:'image/png',buffer:png});
  await expect(page.locator('.attachment-preview')).toContainText('Фото.png');await page.getByLabel('Текст дочернего поля').blur();await page.goBack();
  await expect(page.getByText('Изменения не сохранены',{exact:true})).toBeVisible();await page.getByRole('button',{name:'Остаться',exact:true}).click();await expect(page.locator('.attachment-preview')).toContainText('Фото.png');
  await page.getByRole('button',{name:'Отмена',exact:true}).click();await page.getByRole('button',{name:'Закрыть без сохранения',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(unknown).toEqual([]);expect(errors).toEqual([]);
});

test('Master 047 field families pristine edited revert late defaults busy and new entity',async({page})=>{
  await host(page,'form');
  await page.getByRole('button',{name:'Поздние defaults',exact:true}).click();
  await expect(page.getByLabel('Название',{exact:true})).toHaveValue('Позднее название');
  await page.getByRole('button',{name:'Отмена',exact:true}).click();await expect(page.getByRole('dialog')).toBeHidden();
  await page.getByRole('button',{name:'Открыть форму',exact:true}).click();
  await page.getByLabel('Количество',{exact:true}).fill('12');await page.getByLabel('Включено',{exact:true}).check();
  await page.getByLabel('Получатель',{exact:true}).selectOption('two');await page.getByLabel('Комментарий',{exact:true}).fill('Черновик');
  await page.getByLabel('Дата',{exact:true}).fill('2026-09-17');await page.getByLabel('Время',{exact:true}).fill('2026-09-17T22:00');
  await page.getByRole('button',{name:'Поздние defaults',exact:true}).click();
  await expect(page.getByLabel('Количество',{exact:true})).toHaveValue('12');await expect(page.getByLabel('Получатель',{exact:true})).toHaveValue('two');
  await page.getByRole('button',{name:'Отмена',exact:true}).click();await expect(page.getByText('Изменения не сохранены',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Остаться',exact:true}).click();
  await page.getByRole('button',{name:'Внешний busy',exact:true}).click();await expect(page.getByRole('button',{name:'Отмена',exact:true})).toBeDisabled();
  await page.goBack();await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button',{name:'Внешний busy',exact:true}).click();
  await page.getByRole('button',{name:'Новая сущность',exact:true}).click();
  await expect(page.getByLabel('Количество',{exact:true})).toHaveValue('0');await expect(page.getByLabel('Включено',{exact:true})).not.toBeChecked();
  await page.getByLabel('Название',{exact:true}).fill('Ввод');await page.getByLabel('Название',{exact:true}).fill('');await page.getByLabel('Название',{exact:true}).blur();
  await page.goBack();await expect(page.getByRole('dialog')).toBeHidden();
  expect(unknown).toEqual([]);expect(errors).toEqual([]);
});
test('Master 047 consumer without external busy cannot close or double-submit pending operation',async({page})=>{
  await host(page,'form');await page.evaluate(()=>(window as any).holdSubmit=true);
  await page.getByRole('button',{name:'Подтвердить',exact:true}).click();await expect.poll(()=>page.evaluate(()=>Boolean((window as any).releaseSubmit))).toBe(true);
  await expect(page.getByRole('button',{name:'Отмена',exact:true})).toBeDisabled();
  await page.goBack();await expect(page.getByRole('dialog')).toBeVisible();
  await page.evaluate(()=>(window as any).rejectSubmit(new Error('Отказ изолированного запроса')));
  await expect(page.locator('.error-state')).toContainText('Не удалось сохранить');await expect(page.getByRole('button',{name:'Подтвердить',exact:true})).toBeEnabled();
  await page.evaluate(()=>(window as any).holdSubmit=false);await page.getByRole('button',{name:'Подтвердить',exact:true}).click();
  expect(await page.evaluate(()=>(window as any).submitCalls)).toBe(2);
  expect(unknown).toEqual([]);expect(errors).toEqual([]);
});

test('Master 047 option labels reorder preserve selected identity while hidden drafts are not submitted',async({page})=>{
  await host(page,'form');await page.getByLabel('Получатель',{exact:true}).selectOption('two');await page.getByLabel('Комментарий',{exact:true}).fill('Скрытый черновик');
  await page.getByRole('button',{name:'Обновить варианты',exact:true}).click();await expect(page.getByLabel('Получатель',{exact:true})).toHaveValue('two');await expect(page.getByLabel('Получатель',{exact:true}).locator('option:checked')).toHaveText('Отдел второй — новое имя');
  await page.getByRole('button',{name:'Условное поле',exact:true}).click();await page.getByRole('button',{name:'Подтвердить',exact:true}).click();const submitted=JSON.parse(await page.locator('output').textContent()||'{}');expect(submitted.choice).toBe('two');expect(submitted).not.toHaveProperty('comment');
  await page.getByRole('button',{name:'Условное поле',exact:true}).click();await expect(page.getByLabel('Комментарий',{exact:true})).toHaveValue('Скрытый черновик');expect(unknown).toEqual([]);expect(errors).toEqual([]);
});
