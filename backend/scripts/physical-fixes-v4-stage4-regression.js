const fs = require('fs');
const path = require('path');

const API = process.env.API_URL || 'http://127.0.0.1:3000';
const FACTORY_ID = '537cbb48-7fba-48b6-80af-659f82cdaeb3';
const RUN_ID = 'PFFV4_20260727T075200Z';
const MARKER = '__PFFV4_PFFV4_20260727T075200Z__';
const manifestPath = path.resolve(__dirname, '../../docs/physical-fixes-v4-test-artifacts.json');
const attempt = `${Date.now()}-${process.pid}`;

let passed = 0;
let failed = 0;
const createdArtifacts = [];

function record(name, ok, details) {
  if (ok) {
    passed += 1;
    console.log(`PASS: ${name}`);
    return;
  }
  failed += 1;
  console.error(`FAIL: ${name}${details ? ` — ${details}` : ''}`);
}

async function request(userId, method, route, body) {
  const response = await fetch(`${API}${route}`, {
    method,
    headers: {
      'content-type': 'application/json',
      'x-user-id': userId,
      'x-factory-id': FACTORY_ID,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  return { status: response.status, payload };
}

function addArtifact(model, id, businessKey, cleanupStatus) {
  if (!id) return;
  createdArtifacts.push({
    model,
    id,
    businessKey,
    marker: MARKER,
    createdByRun: RUN_ID,
    cleanupStatus,
  });
}

function persistArtifacts() {
  if (!fs.existsSync(manifestPath) || !createdArtifacts.length) return;
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const known = new Set((manifest.artifacts ?? []).map((item) => `${item.model}:${item.id}`));
  for (const artifact of createdArtifacts) {
    if (!known.has(`${artifact.model}:${artifact.id}`)) manifest.artifacts.push(artifact);
  }
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
}

function activeUserMember(chat, userId) {
  return (chat?.membersSummary ?? []).find((member) => member.userId === userId && member.isActive !== false);
}

async function main() {
  let groupId = null;
  let directId = null;
  try {
    const health = await fetch(`${API}/health`);
    record('fresh backend health is available', health.ok, `HTTP ${health.status}`);

    const createGroup = await request('test-admin', 'POST', '/chats', {
      title: `${MARKER} Группа ${attempt}`,
      type: 'CUSTOM',
      description: 'Targeted Stage 4 membership regression',
      members: [
        { userId: 'worker-3', canRead: true, canWrite: true },
        { userId: 'worker-4', canRead: true, canWrite: true },
      ],
      operationId: `${attempt}:create-group`,
    });
    groupId = createGroup.payload?.id ?? null;
    addArtifact('Chat', groupId, `${MARKER}:stage4-group`, 'ARCHIVED');
    record('custom group is created through API', createGroup.status === 201 && Boolean(groupId), `HTTP ${createGroup.status}`);

    let group = (await request('test-admin', 'GET', `/chats/${groupId}`)).payload;
    const initialOwner = activeUserMember(group, 'test-admin');
    record('creator is the single owner', initialOwner?.membershipRole === 'OWNER'
      && (group.membersSummary ?? []).filter((member) => member.isActive !== false && member.membershipRole === 'OWNER').length === 1);
    record('new users are ordinary members', activeUserMember(group, 'worker-3')?.membershipRole === 'MEMBER'
      && activeUserMember(group, 'worker-4')?.membershipRole === 'MEMBER');

    const ownerLeaveDenied = await request('test-admin', 'POST', `/chats/${groupId}/leave`, {
      operationId: `${attempt}:owner-leave-denied`,
    });
    record('owner cannot leave without transfer', ownerLeaveDenied.status === 409, `HTTP ${ownerLeaveDenied.status}`);

    const promoteOperationId = `${attempt}:promote-worker3`;
    const promote = await request('test-admin', 'POST', `/chats/${groupId}/members/worker-3/role`, {
      role: 'ADMIN',
      operationId: promoteOperationId,
    });
    const promoteReplay = await request('test-admin', 'POST', `/chats/${groupId}/members/worker-3/role`, {
      role: 'ADMIN',
      operationId: promoteOperationId,
    });
    record('owner appoints an admin', promote.status === 201 && promote.payload?.membershipRole === 'ADMIN', `HTTP ${promote.status}`);
    record('replayed role command is idempotent', promoteReplay.status === 201 && promoteReplay.payload?.id === promote.payload?.id);

    group = (await request('test-admin', 'GET', `/chats/${groupId}`)).payload;
    const promotionEvents = (group.messages ?? []).filter((message) => message.kind === 'SYSTEM' && /назначен администратором/i.test(message.text));
    record('membership event is written once after replay/reconnect', promotionEvents.length === 1, `events=${promotionEvents.length}`);

    const adminRemoveOwner = await request('worker-3', 'POST', `/chats/${groupId}/members/test-admin/remove`, {
      operationId: `${attempt}:admin-remove-owner`,
    });
    record('group admin cannot remove owner', adminRemoveOwner.status === 409, `HTTP ${adminRemoveOwner.status}`);

    const adminAddsMember = await request('worker-3', 'POST', `/chats/${groupId}/members`, {
      userId: 'worker-5',
      canRead: true,
      canWrite: true,
      operationId: `${attempt}:admin-add-worker5`,
    });
    record('group admin adds an ordinary member', adminAddsMember.status === 201 && adminAddsMember.payload?.membershipRole === 'MEMBER', `HTTP ${adminAddsMember.status}`);

    const transfer = await request('test-admin', 'POST', `/chats/${groupId}/transfer-ownership`, {
      userId: 'worker-4',
      operationId: `${attempt}:transfer-worker4`,
    });
    record('owner transfers ownership to an active member', transfer.status === 201 && transfer.payload?.membershipRole === 'OWNER', `HTTP ${transfer.status}`);

    group = (await request('worker-4', 'GET', `/chats/${groupId}`)).payload;
    record('group still has exactly one active owner after transfer',
      (group.membersSummary ?? []).filter((member) => member.isActive !== false && member.membershipRole === 'OWNER').length === 1
      && activeUserMember(group, 'worker-4')?.membershipRole === 'OWNER');

    const formerOwnerLeaves = await request('test-admin', 'POST', `/chats/${groupId}/leave`, {
      operationId: `${attempt}:former-owner-leaves`,
    });
    record('former owner can leave as an ordinary member', formerOwnerLeaves.status === 201 && formerOwnerLeaves.payload?.left === true, `HTTP ${formerOwnerLeaves.status}`);

    const removeAdmin = await request('worker-4', 'POST', `/chats/${groupId}/members/worker-3/remove`, {
      operationId: `${attempt}:owner-removes-admin`,
    });
    record('owner removes an admin', removeAdmin.status === 201 && removeAdmin.payload?.isActive === false, `HTTP ${removeAdmin.status}`);
    const removedDirectUrl = await request('worker-3', 'GET', `/chats/${groupId}`);
    record('removed user direct URL is denied', removedDirectUrl.status === 403, `HTTP ${removedDirectUrl.status}`);

    const memberLeaves = await request('worker-5', 'POST', `/chats/${groupId}/leave`, {
      operationId: `${attempt}:worker5-leaves`,
    });
    record('ordinary member leaves the group', memberLeaves.status === 201 && memberLeaves.payload?.left === true, `HTTP ${memberLeaves.status}`);
    const leftDirectUrl = await request('worker-5', 'GET', `/chats/${groupId}`);
    record('user who left cannot reopen direct URL', leftDirectUrl.status === 403, `HTTP ${leftDirectUrl.status}`);

    const openDirect = await request('test-admin', 'POST', '/chats/direct/worker-5', {
      operationId: `${attempt}:direct-open`,
    });
    directId = openDirect.payload?.id ?? null;
    addArtifact('Chat', directId, `${MARKER}:stage4-direct`, 'ARCHIVED');
    record('personal chat is opened', openDirect.status === 201 && Boolean(directId), `HTTP ${openDirect.status}`);

    const initialDirectDetail = await request('test-admin', 'GET', `/chats/${directId}`);
    const activeDirectUserIds = (initialDirectDetail.payload?.membersSummary ?? [])
      .filter((member) => member.isActive !== false && member.userId)
      .map((member) => member.userId)
      .sort();
    record('personal chat resolves to the exact active participant pair',
      initialDirectDetail.status === 200
      && JSON.stringify(activeDirectUserIds) === JSON.stringify(['test-admin', 'worker-5']),
      `members=${activeDirectUserIds.join(',')}`);

    const directAddDenied = await request('test-admin', 'POST', `/chats/${directId}/members`, {
      userId: 'worker-4',
      canRead: true,
      canWrite: true,
      operationId: `${attempt}:direct-add-denied`,
    });
    record('group member add endpoint cannot change a personal chat', directAddDenied.status === 409, `HTTP ${directAddDenied.status}`);

    const directRemoveDenied = await request('test-admin', 'POST', `/chats/${directId}/members/worker-5/remove`, {
      operationId: `${attempt}:direct-remove-denied`,
    });
    record('group member remove endpoint cannot change a personal chat', directRemoveDenied.status === 409, `HTTP ${directRemoveDenied.status}`);

    const block = await request('test-admin', 'POST', `/chats/${directId}/communication-block`, {
      blocked: true,
      operationId: `${attempt}:direct-block`,
    });
    record('personal communication block is stored separately', block.status === 201 && block.payload?.blocked === true, `HTTP ${block.status}`);
    const blockedSend = await request('worker-5', 'POST', `/chats/${directId}/messages`, {
      text: `${MARKER} blocked send`,
      operationId: `${attempt}:blocked-send`,
    });
    record('backend forbids messages while either participant blocks communication', blockedSend.status === 403, `HTTP ${blockedSend.status}`);

    const unblock = await request('test-admin', 'POST', `/chats/${directId}/communication-block`, {
      blocked: false,
      operationId: `${attempt}:direct-unblock`,
    });
    record('personal communication can be unblocked', unblock.status === 201 && unblock.payload?.blocked === false, `HTTP ${unblock.status}`);
    const allowedMessage = await request('worker-5', 'POST', `/chats/${directId}/messages`, {
      text: `${MARKER} direct message`,
      operationId: `${attempt}:direct-message`,
    });
    addArtifact('ChatMessage', allowedMessage.payload?.id, `${MARKER}:stage4-direct-message`, 'SOFT_DELETED');
    record('message succeeds after unblock', allowedMessage.status === 201 && Boolean(allowedMessage.payload?.id), `HTTP ${allowedMessage.status}`);
    if (allowedMessage.payload?.id) {
      const softDelete = await request('worker-5', 'DELETE', `/chats/${directId}/messages/${allowedMessage.payload.id}`);
      record('test direct message is soft deleted', softDelete.status === 200 && softDelete.payload?.deleted === true, `HTTP ${softDelete.status}`);
    }

    const directDetail = await request('test-admin', 'GET', `/chats/${directId}`);
    const directPayloadText = JSON.stringify(directDetail.payload);
    const forbiddenDirectFields = ['passwordHash', 'storagePath', 'DATABASE_URL', 'accessToken', 'refreshToken', 'secret'];
    record('direct detail exposes block state without forbidden technical fields',
      directDetail.status === 200
      && directDetail.payload?.communicationBlocked === false
      && forbiddenDirectFields.every((field) => !directPayloadText.includes(field)));
  } finally {
    if (groupId) {
      const archived = await request('test-admin', 'PATCH', `/chats/${groupId}`, {
        isActive: false,
        reason: `${MARKER} targeted regression complete`,
        operationId: `${attempt}:archive-group`,
      });
      record('test group is archived through normal flow', archived.status === 200 && archived.payload?.isActive === false, `HTTP ${archived.status}`);
    }
    if (directId) {
      const archived = await request('test-admin', 'PATCH', `/chats/${directId}`, {
        isActive: false,
        reason: `${MARKER} targeted regression complete`,
        operationId: `${attempt}:archive-direct`,
      });
      record('test personal chat is archived through normal flow', archived.status === 200 && archived.payload?.isActive === false, `HTTP ${archived.status}`);
    }
    persistArtifacts();
  }

  console.log(`\nPhysical Fixes V4 Stage4: ${passed} passed, ${failed} failed`);
  process.exitCode = failed ? 1 : 0;
}

main().catch((error) => {
  console.error(error?.stack || error);
  process.exitCode = 1;
});
