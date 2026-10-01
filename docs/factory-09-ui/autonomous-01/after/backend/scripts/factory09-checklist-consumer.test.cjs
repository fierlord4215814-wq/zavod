'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const file = path.resolve(__dirname, '../../frontend/src/screens/ChecklistsScreen.tsx');
const source = fs.readFileSync(file, 'utf8');
const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

function findArrow(name) {
  let result;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(tree) === name && node.initializer && ts.isArrowFunction(node.initializer)) result = node.initializer;
    ts.forEachChild(node, visit);
  }
  visit(tree);
  assert.ok(result, `consumer handler ${name} exists`);
  return result;
}
function callsWithin(root, route) {
  const calls = [];
  function visit(node) {
    if (ts.isCallExpression(node) && node.expression.getText(tree).startsWith('apiClient.') && node.arguments[0]?.getText(tree).includes(route)) calls.push(node);
    ts.forEachChild(node, visit);
  }
  visit(root);
  assert.equal(calls.length, 1, `one consumer request to ${route}`);
  return calls[0];
}
test('SOURCE_CONSUMER periodic row save sends selected current checkId to controller', () => {
  const handler = findArrow('saveCurrentRow');
  const body = handler.getText(tree);
  assert.match(body, /checkId:\s*selectedRun\.currentCheck\?\.id\s*\?\?\s*null/);
  const call = callsWithin(handler, '/rows/');
  assert.match(call.getText(tree), /body:\s*JSON\.stringify\(\{\s*\.\.\.payload/);
});
test('SOURCE_CONSUMER periodic completion sends current checkId with operationId', () => {
  const handler = findArrow('completeCurrentPeriodicCheck');
  const body = handler.getText(tree);
  assert.match(body, /const checkId = selectedRun\.currentCheck\.id/);
  const call = callsWithin(handler, '/checks/current/complete');
  assert.match(call.getText(tree), /checkId,\s*operationId:/);
});
