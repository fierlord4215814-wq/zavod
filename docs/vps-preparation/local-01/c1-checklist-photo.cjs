const { chromium } = require('../../../node_modules/@playwright/test');
const { createHash } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { deflateSync } = require('node:zlib');

const title = 'Контроль десяти узлов учебной линии ОКК';

function crc32(buffer) {
  let value = 0xffffffff;
  for (const byte of buffer) {
    value ^= byte;
    for (let i = 0; i < 8; i += 1) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
  }
  return (value ^ 0xffffffff) >>> 0;
}

function chunk(type, bytes) {
  const label = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4); length.writeUInt32BE(bytes.length);
  const checksum = Buffer.alloc(4); checksum.writeUInt32BE(crc32(Buffer.concat([label, bytes])));
  return Buffer.concat([length, label, bytes, checksum]);
}

function png(index) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(2, 0); header.writeUInt32BE(2, 4); header[8] = 8; header[9] = 2;
  const pixel = [index * 21, 255 - index * 18, index * 13];
  const row = Buffer.from([0, ...pixel, ...pixel]);
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.concat([row, row]))), chunk('IEND', Buffer.alloc(0))]);
}

async function actor(browser, runtime, phone, secret) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const frames = [];
  page.on('websocket', (socket) => socket.on('framereceived', (frame) => {
    try { frames.push(JSON.parse(frame.payload).type); } catch { frames.push('non-json'); }
  }));
  await page.goto('http://127.0.0.1:5173/', { waitUntil: 'networkidle' });
  await page.locator('#login-phone').fill(phone);
  await page.locator('#login-password').fill(readFileSync(join(runtime, 'secrets', secret), 'utf8'));
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  const option = page.locator('[data-testid="factory-picker"]').getByRole('button', { name: /Завод LOCAL-01/ });
  await option.waitFor({ state: 'visible' });
  await option.click();
  await page.getByRole('heading', { name: 'Завод LOCAL-01', exact: true }).waitFor();
  return { context, page, frames };
}

async function api(page, method, path, body) {
  return page.evaluate(async ({ m, p, b }) => {
    const response = await fetch(`/api${p}`, { method: m,
      headers: { Authorization: `Bearer ${localStorage.getItem('zavod.authToken')}`,
        'x-factory-id': localStorage.getItem('zavod.selectedFactoryId'), 'Content-Type': 'application/json' },
      ...(b === undefined ? {} : { body: JSON.stringify(b) }) });
    let data = null;
    try { data = await response.json(); } catch { /* no body */ }
    return { status: response.status, body: data };
  }, { m: method, p: path, b: body });
}

async function upload(page, rowId, bytes, index) {
  return page.evaluate(async ({ id, content, number }) => {
    const form = new FormData();
    form.append('file', new File([Uint8Array.from(content)], `node-${number}.png`, { type: 'image/png' }));
    form.append('entityType', 'CHECKLIST_RUN_ROW');
    form.append('entityId', id);
    form.append('kind', 'PHOTO');
    form.append('operationId', `local01-checklist-photo-${number}`);
    const response = await fetch('/api/attachments/upload', { method: 'POST',
      headers: { Authorization: `Bearer ${localStorage.getItem('zavod.authToken')}`,
        'x-factory-id': localStorage.getItem('zavod.selectedFactoryId') }, body: form });
    return { status: response.status, body: await response.json() };
  }, { id: rowId, content: Array.from(bytes), number: index });
}

async function download(page, id) {
  return page.evaluate(async (attachmentId) => {
    const response = await fetch(`/api/attachments/${attachmentId}/file`, {
      headers: { Authorization: `Bearer ${localStorage.getItem('zavod.authToken')}`,
        'x-factory-id': localStorage.getItem('zavod.selectedFactoryId') } });
    return { status: response.status, bytes: Array.from(new Uint8Array(await response.arrayBuffer())) };
  }, id);
}

async function main() {
  const runtime = process.env.LOCAL01_RUNTIME_DIR;
  if (!runtime) throw new Error('LOCAL01_RUNTIME_DIR is required');
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  let admin, worker, other;
  try {
    admin = await actor(browser, runtime, '+79990001001', 'admin-personal.txt');
    worker = await actor(browser, runtime, '+79990001004', 'role-okk.txt');
    other = await actor(browser, runtime, '+79990001008', 'role-other.txt');
    let me = await api(worker.page, 'GET', '/auth/me');
    if (me.status !== 200 || !me.body.userId) throw new Error('OKK identity unavailable');
    if (!me.body.departmentId) {
      const departments = await api(admin.page, 'GET', '/admin/departments');
      if (departments.status !== 200) throw new Error(`Department list ${departments.status}`);
      let department = departments.body.find((entry) => entry.code === 'local01-a-checklist');
      if (!department) {
        const created = await api(admin.page, 'POST', '/admin/departments', {
          factoryId: me.body.selectedFactoryId, scope: 'LOCAL', code: 'local01-a-checklist',
          name: 'Учебная смена чек-листов А', isActive: true,
        });
        if (created.status !== 201) throw new Error(`Checklist department create ${created.status}`);
        department = created.body;
      }
      const assigned = await api(admin.page, 'PATCH', `/admin/users/${me.body.userId}/factory-access`, {
        departmentId: department.id, reason: 'Учебный десятипунктовый фото-чек-лист LOCAL-01',
      });
      if (assigned.status !== 200) throw new Error(`OKK department assignment ${assigned.status}`);
      await worker.context.close();
      worker = await actor(browser, runtime, '+79990001004', 'role-okk.txt');
      me = await api(worker.page, 'GET', '/auth/me');
    }
    if (!me.body.departmentId) throw new Error('OKK department still unavailable');
    const rows = Array.from({ length: 10 }, (_, i) => ({ title: `Узел ${String(i + 1).padStart(2, '0')}: фото состояния`,
      sortOrder: (i + 1) * 10, rowType: 'REQUIRED_PHOTO', isRequired: true, requiresPhoto: true }));
    let template = (await api(admin.page, 'GET', '/checklists/templates')).body?.find((entry) => entry.name === title);
    if (!template) {
      const created = await api(admin.page, 'POST', '/checklists/templates', {
        name: title, description: 'Функциональная проверка десяти разных фото на учебной площадке А.',
        departmentId: me.body.departmentId, assignmentRoles: ['OKK'], frequencyRule: 'MANUAL', rows, isActive: true,
      });
      if (created.status !== 201 || !created.body?.id) throw new Error(`Template create ${created.status}: ${JSON.stringify(created.body)}`);
      template = created.body;
    }
    if (!template?.id || template.rows?.length !== 10) throw new Error('Template does not contain ten rows');
    const available = await api(worker.page, 'GET', '/checklists/available');
    if (available.status !== 200) throw new Error(`Worker available ${available.status}`);
    let run = (await api(worker.page, 'GET', '/checklists/runs/my')).body?.find((entry) => entry.templateId === template.id && entry.status === 'ACTIVE');
    if (!run) {
      const started = await api(worker.page, 'POST', '/checklists/runs', { templateId: template.id });
      if (started.status !== 201 || !started.body?.id) throw new Error(`Run start ${started.status}: ${JSON.stringify(started.body)}`);
      run = started.body;
    }
    if (!run?.id || run.rows?.length !== 10) throw new Error('Run does not contain ten rows');
    const otherRun = await api(other.page, 'GET', `/checklists/runs/${run.id}`);
    if (otherRun.status === 200) throw new Error('OTHER read another user checklist');
    const beforePhoto = await api(worker.page, 'POST', `/checklists/runs/${run.id}/rows/${run.rows[0].id}/complete`,
      { operationId: 'local01-checklist-no-photo-1', status: 'OK' });
    if (beforePhoto.status !== 409) throw new Error(`Missing photo expected 409, got ${beforePhoto.status}`);
    const hashes = [];
    const attachmentIds = [];
    for (let i = 0; i < run.rows.length; i += 1) {
      const row = run.rows[i];
      const bytes = png(i + 1);
      const uploaded = await upload(worker.page, row.id, bytes, i + 1);
      if (uploaded.status !== 201 || !uploaded.body?.id) throw new Error(`Photo ${i + 1} upload ${uploaded.status}`);
      const readback = await download(worker.page, uploaded.body.id);
      if (readback.status !== 200 || !Buffer.from(readback.bytes).equals(bytes)) throw new Error(`Photo ${i + 1} byte mismatch`);
      const completed = await api(worker.page, 'POST', `/checklists/runs/${run.id}/rows/${row.id}/complete`,
        { operationId: `local01-checklist-row-${i + 1}`, status: 'OK' });
      if (completed.status !== 201 || completed.body?.status !== 'OK') throw new Error(`Row ${i + 1} complete ${completed.status}`);
      attachmentIds.push(uploaded.body.id);
      hashes.push(createHash('sha256').update(bytes).digest('hex'));
    }
    if (new Set(hashes).size !== 10) throw new Error('Photos are not distinct');
    const closed = await api(worker.page, 'POST', `/checklists/runs/${run.id}/close`, { reason: 'Все десять узлов учебной линии проверены.' });
    if (closed.status !== 201 || closed.body?.status !== 'CLOSED') throw new Error(`Run close ${closed.status}: ${JSON.stringify(closed.body)}`);
    const archive = await api(worker.page, 'GET', '/checklists/archive');
    const archived = archive.body?.runs?.find((entry) => entry.id === run.id);
    if (archive.status !== 200 || !archived || archived.rows?.filter((row) => row.status === 'OK').length !== 10) throw new Error('Closed run archive mismatch');
    const adminArchive = await api(admin.page, 'GET', '/checklists/archive');
    if (adminArchive.status !== 200 || !adminArchive.body?.runs?.some((entry) => entry.id === run.id)) throw new Error('ADMIN archive missing run');
    console.log(JSON.stringify({ phase: 'ten-photo-checklist', templateId: template.id, runId: run.id,
      photoIds: attachmentIds, uniquePhotoHashes: new Set(hashes).size, missingPhotoStatus: beforePhoto.status,
      otherRunStatus: otherRun.status, closeStatus: closed.status, archiveStatus: archive.status,
      archivedOkRows: archived.rows.filter((row) => row.status === 'OK').length,
      workerFrames: worker.frames, adminFrames: admin.frames }));
  } finally {
    await other?.context.close();
    await worker?.context.close();
    await admin?.context.close();
    await browser.close();
  }
}

main().catch((error) => { console.error(`C1_CHECKLIST_PHOTO_FAILED=${error.message}`); process.exitCode = 1; });
