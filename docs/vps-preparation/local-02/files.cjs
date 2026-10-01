const { deflateSync } = require('node:zlib');
const { createHash } = require('node:crypto');
function chunk(type, bytes) {
  const label = Buffer.from(type); const payload = Buffer.concat([label, bytes]); let crc = 0xffffffff;
  for (const byte of payload) { crc ^= byte; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0); }
  const length = Buffer.alloc(4); length.writeUInt32BE(bytes.length); const end = Buffer.alloc(4); end.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return Buffer.concat([length, payload, end]);
}
function png(index) {
  const header = Buffer.alloc(13); header.writeUInt32BE(24, 0); header.writeUInt32BE(24, 4); header[8] = 8; header[9] = 2;
  const rows = Array.from({ length: 24 }, (_, y) => Buffer.from([0, ...Array.from({ length: 24 }, (_, x) => [(index * 51 + x * 3) % 256, (index * 37 + y * 5) % 256, (index * 73 + x + y) % 256]).flat()]));
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', header), chunk('IDAT', deflateSync(Buffer.concat(rows))), chunk('IEND', Buffer.alloc(0))]);
}
const sha = (bytes) => createHash('sha256').update(Buffer.from(bytes)).digest('hex');
async function upload(page, entityType, entityId, bytes, operationId) {
  return page.evaluate(async ({ entityType, entityId, bytes, operationId }) => {
    const form = new FormData(); form.append('file', new File([Uint8Array.from(bytes)], `${operationId}.png`, { type: 'image/png' }));
    for (const [key, value] of Object.entries({ entityType, entityId, kind: 'PHOTO', operationId })) form.append(key, value);
    const r = await fetch('/api/attachments/upload', { method: 'POST', headers: { Authorization: `Bearer ${localStorage.getItem('zavod.authToken')}`, 'x-factory-id': localStorage.getItem('zavod.selectedFactoryId') }, body: form });
    return { status: r.status, body: await r.json() };
  }, { entityType, entityId, bytes: Array.from(bytes), operationId });
}
async function download(page, id, factoryId) {
  return page.evaluate(async ({ id, factoryId }) => {
    const r = await fetch(`/api/attachments/${id}/file`, { headers: { Authorization: `Bearer ${localStorage.getItem('zavod.authToken')}`, 'x-factory-id': factoryId ?? localStorage.getItem('zavod.selectedFactoryId') } });
    return { status: r.status, bytes: Array.from(new Uint8Array(await r.arrayBuffer())) };
  }, { id, factoryId });
}
module.exports = { png, sha, upload, download };
