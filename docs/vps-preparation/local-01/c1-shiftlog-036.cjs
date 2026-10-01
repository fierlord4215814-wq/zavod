const { chromium } = require('../../../node_modules/@playwright/test');
const { createHash } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const title = 'Передача сведений по учебному отделу ОКК';
const fileText = 'Учебное вложение пересменки: состояние лабораторного узла подтверждено.\n';

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

async function upload(page, id, operationId) {
  return page.evaluate(async ({ logId, content, op }) => {
    const form = new FormData();
    form.append('file', new File([new TextEncoder().encode(content)], 'handover-note.txt', { type: 'text/plain' }));
    form.append('entityType', 'SHIFT_LOG');
    form.append('entityId', logId);
    form.append('kind', 'FILE');
    form.append('operationId', op);
    const response = await fetch('/api/attachments/upload', { method: 'POST',
      headers: { Authorization: `Bearer ${localStorage.getItem('zavod.authToken')}`,
        'x-factory-id': localStorage.getItem('zavod.selectedFactoryId') }, body: form });
    return { status: response.status, body: await response.json() };
  }, { logId: id, content: fileText, op: operationId });
}

async function file(page, id) {
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
  let admin, okk, other;
  try {
    admin = await actor(browser, runtime, '+79990001001', 'admin-personal.txt');
    okk = await actor(browser, runtime, '+79990001004', 'role-okk.txt');
    other = await actor(browser, runtime, '+79990001008', 'role-other.txt');
    const me = await api(okk.page, 'GET', '/auth/me');
    if (me.status !== 200 || !me.body.departmentId) throw new Error('OKK department unavailable');
    let log = (await api(admin.page, 'GET', '/shift-log')).body?.find((entry) => entry.title === title);
    if (!log) {
      const created = await api(okk.page, 'POST', '/shift-log', { title,
        text: 'Учебный лабораторный узел проверен, результат передан следующей смене.',
        departmentId: me.body.departmentId, shiftLabel: 'День', isImportant: false });
      if (created.status !== 201 || !created.body?.id) throw new Error(`Ordinary log create ${created.status}: ${JSON.stringify(created.body)}`);
      log = created.body;
    }
    const activeOkk = await api(okk.page, 'GET', `/shift-log/${log.id}`);
    const activeAdmin = await api(admin.page, 'GET', `/shift-log/${log.id}`);
    if (activeOkk.status !== 200 || activeAdmin.status !== 200) throw new Error(`Active detail ${activeOkk.status}/${activeAdmin.status}`);
    const attached = await upload(admin.page, log.id, 'local01-shiftlog-036-file-1');
    if (attached.status !== 201 || !attached.body?.id) throw new Error(`Active file upload ${attached.status}`);
    const archived = await api(admin.page, 'POST', `/shift-log/${log.id}/archive`, {});
    if (archived.status !== 201 || archived.body?.isDeleted !== true) throw new Error(`Archive ${archived.status}: ${JSON.stringify(archived.body)}`);
    const archiveList = await api(admin.page, 'GET', '/shift-log/archive');
    const archiveDetail = await api(admin.page, 'GET', `/shift-log/archive/${log.id}`);
    const ordinaryBypass = await api(admin.page, 'GET', '/shift-log?archive=true&includeClosed=true');
    const ordinaryDetail = await api(admin.page, 'GET', `/shift-log/${log.id}`);
    const okkArchive = await api(okk.page, 'GET', `/shift-log/archive/${log.id}`);
    const otherArchive = await api(other.page, 'GET', `/shift-log/archive/${log.id}`);
    const okkOrdinary = await api(okk.page, 'GET', `/shift-log/${log.id}`);
    const read = await api(admin.page, 'POST', `/shift-log/${log.id}/read`, {});
    const comment = await api(admin.page, 'POST', `/shift-log/${log.id}/comment`, { text: 'Недопустимо после архивации' });
    const adminFile = await file(admin.page, attached.body.id);
    const okkFile = await file(okk.page, attached.body.id);
    const uploadAfter = await upload(admin.page, log.id, 'local01-shiftlog-036-file-after-archive');
    const sameFile = Buffer.from(adminFile.bytes).equals(Buffer.from(fileText, 'utf8'));
    if (archiveList.status !== 200 || !archiveList.body.some((entry) => entry.id === log.id)
      || archiveDetail.status !== 200 || archiveDetail.body.archiveReadOnly !== true
      || JSON.stringify(archiveDetail.body.availableActions) !== '["read"]'
      || ordinaryBypass.status !== 200 || ordinaryBypass.body.some((entry) => entry.id === log.id)
      || ordinaryDetail.status === 200 || okkArchive.status !== 403 || otherArchive.status === 200
      || okkOrdinary.status === 200 || read.status === 201 || comment.status === 201
      || adminFile.status !== 200 || !sameFile || okkFile.status !== 403
      || uploadAfter.status === 201) {
      throw new Error(JSON.stringify({ archiveList: archiveList.status, detail: archiveDetail.status,
        bypass: ordinaryBypass.status, ordinaryDetail: ordinaryDetail.status, okkArchive: okkArchive.status,
        otherArchive: otherArchive.status, okkOrdinary: okkOrdinary.status, read: read.status,
        comment: comment.status, adminFile: adminFile.status, sameFile, okkFile: okkFile.status,
        uploadAfter: uploadAfter.status }));
    }
    console.log(JSON.stringify({ phase: 'shiftlog-036-live-http', logId: log.id, attachmentId: attached.body.id,
      activeStatuses: [activeOkk.status, activeAdmin.status], archiveStatus: archived.status,
      archiveListStatus: archiveList.status, archiveDetailStatus: archiveDetail.status,
      ordinaryBypassStatus: ordinaryBypass.status, ordinaryDetailStatus: ordinaryDetail.status,
      okkArchiveStatus: okkArchive.status, otherArchiveStatus: otherArchive.status,
      readStatus: read.status, commentStatus: comment.status, adminFileStatus: adminFile.status,
      okkFileStatus: okkFile.status, uploadAfterStatus: uploadAfter.status, attachmentDeleteNotAttempted: true,
      fileSha256: createHash('sha256').update(Buffer.from(adminFile.bytes)).digest('hex'),
      adminFrames: admin.frames, okkFrames: okk.frames }));
  } finally {
    await other?.context.close();
    await okk?.context.close();
    await admin?.context.close();
    await browser.close();
  }
}

main().catch((error) => { console.error(`C1_SHIFTLOG_036_FAILED=${error.message}`); process.exitCode = 1; });
