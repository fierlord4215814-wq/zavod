'use strict';

// Exact TSX in a synthetic hook/element harness. No browser, server or DB.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const source = fs.readFileSync(path.join(__dirname, '../src/components/ChamberPanel.tsx'), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React,
} }).outputText;
const chamberA = { id: 'chamber-A', lineId: null, name: 'Камера А', lineName: null };
const chamberB = { id: 'chamber-B', lineId: null, name: 'Камера Б', lineName: null };
const activeA = { id: 'event-A', status: 'ACTIVE', eventType: 'DEFROST', startAt: '2026-09-30T10:00:00Z', endAt: null, comment: null, endComment: null };
const activeB = { ...activeA, id: 'event-B' };
const user = { userId: 'fixture-user', isGuest: false, isAdmin: false, role: 'TECH_HOLOD', permissions: ['defrost.manage'] };
const manager = { ...user, role: 'ADMIN', isAdmin: true, permissions: ['defrost.manage', 'admin.lines.manage'] };

function harness(initialUser = user) {
  const slots = [];
  const pendingHistory = [];
  const posts = [];
  const listeners = new Map();
  let index = 0;
  let scheduled = [];
  let currentUser = initialUser;
  let factoryId = 'factory-9';
  let hiddenRows = [];
  let postGate = null;
  const depsEqual = (a, b) => a && b && a.length === b.length && a.every((value, i) => Object.is(value, b[i]));
  const react = {
    createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
    useState(initial) {
      const i = index++;
      if (!slots[i]) slots[i] = { value: typeof initial === 'function' ? initial() : initial };
      return [slots[i].value, (next) => { slots[i].value = typeof next === 'function' ? next(slots[i].value) : next; }];
    },
    useRef(initial) {
      const i = index++;
      if (!slots[i]) slots[i] = { value: { current: initial } };
      return slots[i].value;
    },
    useCallback(fn, deps) {
      const i = index++;
      if (!slots[i] || !depsEqual(slots[i].deps, deps)) slots[i] = { fn, deps };
      return slots[i].fn;
    },
    useEffect(fn, deps) {
      const i = index++;
      if (!slots[i] || !depsEqual(slots[i].deps, deps)) {
        const previous = slots[i];
        slots[i] = { deps, cleanup: null };
        scheduled.push(() => { previous?.cleanup?.(); slots[i].cleanup = fn() || null; });
      }
    },
  };
  const apiClient = {
    async get(url) {
      if (url.startsWith('/defrost/chambers?')) return url.endsWith('hidden=true') ? hiddenRows : [chamberA, chamberB];
      if (url.endsWith('/history')) return new Promise((resolve, reject) => pendingHistory.push({ url, resolve, reject, settled: false }));
      throw new Error(`Unexpected GET ${url}`);
    },
    async post(url, payload) {
      posts.push({ url, payload });
      if (postGate) await postGate;
      return {};
    },
    async patch(url, payload) { posts.push({ url, payload }); return {}; },
  };
  const windowStub = {
    addEventListener(name, fn) { listeners.set(name, fn); },
    removeEventListener(name, fn) { if (listeners.get(name) === fn) listeners.delete(name); },
  };
  const context = { module: { exports: {} }, exports: {}, console, window: windowStub,
    require(id) { if (id === 'react') return react; if (id === '../api/client') return { apiClient }; throw new Error(`Unexpected import ${id}`); } };
  context.exports = context.module.exports;
  vm.runInNewContext(compiled, context);
  function render() {
    index = 0;
    scheduled = [];
    const tree = context.module.exports.ChamberPanel({ currentUser, factoryId });
    const effects = scheduled;
    for (const effect of effects) effect();
    return tree;
  }
  function settle(id, events, error = false) {
    const request = pendingHistory.find((item) => !item.settled && item.url === `/defrost/chambers/${id}/history`);
    assert.ok(request, `Pending history for ${id}`);
    request.settled = true;
    if (error) request.reject(new Error('Synthetic history failure'));
    else request.resolve(events);
  }
  return { render, settle, posts, pendingHistory, setUser(value) { currentUser = value; },
    setFactory(value) { factoryId = value; }, setHiddenRows(rows) { hiddenRows = rows; },
    setPostGate(value) { postGate = value; }, dispatch(name) { listeners.get(name)?.(); } };
}

function* walk(value) {
  if (Array.isArray(value)) { for (const item of value) yield* walk(item); }
  else if (value && typeof value === 'object') { yield value; yield* walk(value.props?.children); }
}
function label(value) {
  if (Array.isArray(value)) return value.map(label).join('');
  if (value && typeof value === 'object') return label(value.props?.children);
  return value ?? '';
}
function button(tree, text) {
  return [...walk(tree)].find((node) => node.type === 'button' && label(node.props.children).includes(text));
}
function select(tree, name) {
  const card = [...walk(tree)].find((node) => node.type === 'button' && node.props.className === 'defrost-line-card' && label(node.props.children).includes(name));
  assert.ok(card, `Camera card ${name}`);
  card.props.onClick();
}
const drain = () => new Promise((resolve) => setImmediate(resolve));

test('A active → B pending/empty cannot end A; B starts by its own chamberId', async () => {
  const h = harness(); h.render(); await drain(); let tree = h.render();
  select(tree, 'Камера А'); h.settle('chamber-A', [activeA]); await drain(); tree = h.render();
  assert.equal(button(tree, 'Завершить оттайку').props.disabled, false);
  const staleAction = button(tree, 'Завершить оттайку');
  select(tree, 'Камера Б'); tree = h.render();
  assert.equal(button(tree, 'Загрузка истории').props.disabled, true);
  staleAction.props.onClick(); await drain(); assert.equal(h.posts.length, 0);
  h.settle('chamber-B', []); await drain(); tree = h.render();
  button(tree, 'Начать оттайку').props.onClick(); await drain();
  assert.deepEqual(h.posts.map((item) => item.url), ['/defrost/start']);
  assert.equal(h.posts[0].payload.chamberId, 'chamber-B');
});

test('A empty → B active never offers start before B history; end targets event B', async () => {
  const h = harness(); h.render(); await drain(); let tree = h.render();
  select(tree, 'Камера А'); h.settle('chamber-A', []); await drain(); tree = h.render();
  select(tree, 'Камера Б'); tree = h.render();
  assert.equal(button(tree, 'Загрузка истории').props.disabled, true);
  h.settle('chamber-B', [activeB]); await drain(); tree = h.render();
  button(tree, 'Завершить оттайку').props.onClick(); await drain();
  assert.deepEqual(h.posts.map((item) => item.url), ['/defrost/event-B/end']);
});

test('out-of-order A response, history error/retry and context switch fail closed', async () => {
  const h = harness(); h.render(); await drain(); let tree = h.render();
  select(tree, 'Камера А'); tree = h.render();
  select(tree, 'Камера Б'); h.settle('chamber-B', [activeB]); await drain();
  h.settle('chamber-A', [activeA]); await drain(); tree = h.render();
  assert.equal(button(tree, 'Завершить оттайку').props.disabled, false);
  h.dispatch('zavod:defrost-updated'); tree = h.render();
  assert.equal(button(tree, 'Загрузка истории').props.disabled, true);
  h.settle('chamber-B', [], true); await drain(); tree = h.render();
  assert.equal(button(tree, 'Загрузка истории').props.disabled, true);
  assert.ok(button(tree, 'Повторить'));
  button(tree, 'Повторить').props.onClick(); h.settle('chamber-B', []); await drain(); tree = h.render();
  assert.ok(button(tree, 'Начать оттайку'));
  h.setFactory('factory-4'); tree = h.render();
  assert.equal(button(tree, 'Начать оттайку'), undefined);
  h.setUser(null); tree = h.render();
  assert.equal(button(tree, 'Завершить оттайку'), undefined);
  assert.equal(h.posts.length, 0);
});

test('hide mode invalidates pending history; pending operation pins target and normal cycle reloads', async () => {
  const h = harness(manager); h.render(); await drain(); let tree = h.render();
  select(tree, 'Камера А'); h.settle('chamber-A', []); await drain(); tree = h.render();
  let releasePost;
  h.setPostGate(new Promise((resolve) => { releasePost = resolve; }));
  button(tree, 'Начать оттайку').props.onClick(); tree = h.render();
  assert.equal(button(tree, 'Начать оттайку').props.disabled, true);
  select(tree, 'Камера Б'); tree = h.render();
  assert.ok(label(tree).includes('Камера А'));
  releasePost(); await drain();
  assert.equal(h.posts[0].url, '/defrost/start');
  assert.equal(h.posts[0].payload.chamberId, 'chamber-A');
  h.settle('chamber-A', [activeA]); await drain(); tree = h.render();
  assert.ok(button(tree, 'Завершить оттайку'));
  button(tree, 'Скрытые').props.onClick(); tree = h.render();
  assert.equal(button(tree, 'Завершить оттайку'), undefined);
  assert.equal(h.posts.length, 1);
});
