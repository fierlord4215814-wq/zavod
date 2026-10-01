const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const frontendRoot = path.join(root, 'frontend', 'src');
const backendRoot = path.join(root, 'backend', 'src');
const evidenceDir = path.join(root, 'docs', 'physical-field-fixes-v5-plast17a');
const outputPath = path.join(evidenceDir, 'test-artifacts.json');

function walk(directory, predicate) {
  const result = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...walk(fullPath, predicate));
    else if (predicate(fullPath)) result.push(fullPath);
  }
  return result.sort();
}

function relative(file) {
  return path.relative(root, file).replace(/\\/g, '/');
}

function sourceFile(file) {
  const text = fs.readFileSync(file, 'utf8');
  return {
    text,
    ast: ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS),
  };
}

function lineOf(ast, node) {
  return ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1;
}

function stringValue(node, ast) {
  if (!node) return null;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isTemplateExpression(node)) {
    let value = node.head.text;
    for (const span of node.templateSpans) value += `:${span.expression.getText(ast)}${span.literal.text}`;
    return value;
  }
  return node.getText(ast);
}

function jsxTagName(node) {
  const tag = node.tagName;
  return ts.isIdentifier(tag) ? tag.text : tag.getText();
}

function jsxAttribute(node, name, ast) {
  const attr = node.attributes.properties.find((item) => ts.isJsxAttribute(item) && item.name.getText(ast) === name);
  if (!attr || !ts.isJsxAttribute(attr) || !attr.initializer) return null;
  if (ts.isStringLiteral(attr.initializer)) return attr.initializer.text;
  if (ts.isJsxExpression(attr.initializer) && attr.initializer.expression) return stringValue(attr.initializer.expression, ast);
  return null;
}

function resolveRelativeImport(fromFile, specifier) {
  if (!specifier.startsWith('.')) return null;
  const base = path.resolve(path.dirname(fromFile), specifier);
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    path.join(base, 'index.ts'),
    path.join(base, 'index.tsx'),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile()) ?? null;
}

function frontendFileCensus(file) {
  const { text, ast } = sourceFile(file);
  const imports = [];
  const exports = [];
  const apiCalls = [];
  const layers = [];
  const stateContexts = [];
  const staticArrays = [];
  const directNetworkCalls = [];

  function visit(node) {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      imports.push({ specifier: node.moduleSpecifier.text, resolved: resolveRelativeImport(file, node.moduleSpecifier.text) });
    }

    if ((ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) && node.name) {
      const isExport = node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword);
      if (isExport) exports.push(node.name.text);
    }

    if (ts.isVariableStatement(node) && node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)) {
      for (const declaration of node.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) exports.push(declaration.name.text);
      }
    }

    if (ts.isCallExpression(node)) {
      const expression = node.expression;
      if (ts.isPropertyAccessExpression(expression) && ts.isIdentifier(expression.expression) && expression.expression.text === 'apiClient') {
        let method = expression.name.text.toUpperCase();
        if (method === 'GET') method = 'GET';
        else if (method === 'POST' || method === 'UPLOAD' || method === 'UPLOADWITHPROGRESS') method = 'POST';
        else if (method === 'PATCH') method = 'PATCH';
        else if (method === 'DOWNLOADBLOB') method = 'GET';
        else if (method === 'REQUEST') {
          const options = node.arguments[1];
          const methodProperty = options && ts.isObjectLiteralExpression(options)
            ? options.properties.find((property) => ts.isPropertyAssignment(property) && property.name.getText(ast) === 'method')
            : null;
          method = methodProperty && ts.isPropertyAssignment(methodProperty)
            ? String(stringValue(methodProperty.initializer, ast) ?? 'REQUEST').toUpperCase()
            : 'REQUEST';
        }
        apiCalls.push({ method, endpoint: stringValue(node.arguments[0], ast), line: lineOf(ast, node) });
      }

      if (ts.isIdentifier(expression) && ['fetch', 'WebSocket'].includes(expression.text)) {
        directNetworkCalls.push({ kind: expression.text, target: stringValue(node.arguments[0], ast), line: lineOf(ast, node) });
      }

      if (ts.isIdentifier(expression) && expression.text === 'useState') {
        const parent = node.parent;
        const declaration = ts.isVariableDeclaration(parent) ? parent : null;
        const name = declaration && ts.isArrayBindingPattern(declaration.name) && declaration.name.elements[0]
          ? declaration.name.elements[0].name.getText(ast)
          : null;
        if (name) {
          stateContexts.push({
            name,
            type: node.typeArguments?.[0]?.getText(ast) ?? null,
            initial: stringValue(node.arguments[0], ast),
            line: lineOf(ast, node),
          });
        }
      }
    }

    if (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) {
      const tag = jsxTagName(node);
      if (/^(PremiumSheet|ActionModal|AppConfirmDialog|AdminConfirmDialog|AttachmentPicker|AttachmentPreviewList|QuantityRelease|PeopleSearchPanel|CompactPeoplePicker)$/.test(tag)) {
        layers.push({
          kind: tag,
          title: jsxAttribute(node, 'title', ast) ?? jsxAttribute(node, 'aria-label', ast) ?? jsxAttribute(node, 'heading', ast),
          line: lineOf(ast, node),
        });
      }
    }

    if (ts.isVariableDeclaration(node) && node.initializer && ts.isArrayLiteralExpression(node.initializer)) {
      const literals = node.initializer.elements.filter((item) => ts.isStringLiteral(item)).map((item) => item.text);
      if (literals.length >= 2) {
        staticArrays.push({ name: node.name.getText(ast), values: literals, line: lineOf(ast, node) });
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(ast);
  return {
    file: relative(file),
    lines: text.split(/\r?\n/).length,
    imports: imports.map((item) => ({ specifier: item.specifier, resolved: item.resolved ? relative(item.resolved) : null })),
    exports: [...new Set(exports)],
    apiCalls,
    layers,
    stateContexts,
    staticArrays,
    directNetworkCalls,
  };
}

function decoratorName(decorator, ast) {
  const expression = decorator.expression;
  if (ts.isCallExpression(expression)) return expression.expression.getText(ast);
  return expression.getText(ast);
}

function decoratorArgument(decorator, ast) {
  const expression = decorator.expression;
  if (!ts.isCallExpression(expression)) return '';
  return String(stringValue(expression.arguments[0], ast) ?? '');
}

function backendControllerCensus(file) {
  const { ast } = sourceFile(file);
  const endpoints = [];
  let controllerBase = '';
  let controllerName = '';

  function visit(node) {
    if (ts.isClassDeclaration(node)) {
      controllerName = node.name?.text ?? '';
      for (const decorator of ts.getDecorators(node) ?? []) {
        if (decoratorName(decorator, ast) === 'Controller') controllerBase = decoratorArgument(decorator, ast);
      }
      for (const member of node.members) {
        if (!ts.isMethodDeclaration(member)) continue;
        const routeDecorator = (ts.getDecorators(member) ?? []).find((decorator) => /^(Get|Post|Patch|Put|Delete)$/.test(decoratorName(decorator, ast)));
        if (!routeDecorator) continue;
        const permissionDecorator = (ts.getDecorators(member) ?? []).find((decorator) => decoratorName(decorator, ast) === 'RequirePermission');
        const calls = [];
        function methodVisit(child) {
          if (
            ts.isCallExpression(child)
            && ts.isPropertyAccessExpression(child.expression)
            && ts.isPropertyAccessExpression(child.expression.expression)
            && child.expression.expression.expression.kind === ts.SyntaxKind.ThisKeyword
          ) {
            calls.push(`${child.expression.expression.name.text}.${child.expression.name.text}`);
          }
          ts.forEachChild(child, methodVisit);
        }
        if (member.body) methodVisit(member.body);
        endpoints.push({
          method: decoratorName(routeDecorator, ast).toUpperCase(),
          path: `/${[controllerBase, decoratorArgument(routeDecorator, ast)].filter(Boolean).join('/')}`.replace(/\/+/g, '/'),
          handler: member.name.getText(ast),
          permission: permissionDecorator ? decoratorArgument(permissionDecorator, ast) : null,
          calls: [...new Set(calls)],
          line: lineOf(ast, member),
        });
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  return { file: relative(file), controller: controllerName, base: controllerBase, endpoints };
}

function serviceModelCensus(file) {
  const { ast } = sourceFile(file);
  const models = new Set();
  function visit(node) {
    if (
      ts.isPropertyAccessExpression(node)
      && ts.isPropertyAccessExpression(node.expression)
      && node.expression.name.text === 'db'
      && ts.isIdentifier(node.expression.expression)
      && /prisma/i.test(node.expression.expression.text)
    ) {
      models.add(node.name.text);
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  return { file: relative(file), models: [...models].sort() };
}

function endpointPattern(value) {
  return String(value ?? '')
    .replace(/^\/api/, '')
    .split('?')[0]
    .replace(/:[A-Za-z_$][A-Za-z0-9_$.()[\]-]*/g, ':param')
    .replace(/\/+/g, '/')
    .replace(/\/$/, '') || '/';
}

function endpointMatches(frontendPath, backendPath) {
  const front = endpointPattern(frontendPath).split('/').filter(Boolean);
  const back = endpointPattern(backendPath).split('/').filter(Boolean);
  if (front.length !== back.length) return false;
  return front.every((segment, index) => segment === back[index] || segment.startsWith(':') || back[index].startsWith(':'));
}

const frontendFiles = walk(frontendRoot, (file) => /\.(ts|tsx)$/.test(file));
const frontend = frontendFiles.map(frontendFileCensus);
const fileByName = new Map(frontend.map((item) => [item.file, item]));

const reachable = new Set();
function markReachable(fileName) {
  if (reachable.has(fileName)) return;
  reachable.add(fileName);
  const item = fileByName.get(fileName);
  if (!item) return;
  for (const imported of item.imports) if (imported.resolved) markReachable(imported.resolved);
}
markReachable('frontend/src/main.tsx');

const controllerFiles = walk(backendRoot, (file) => file.endsWith('.controller.ts'));
const controllers = controllerFiles.map(backendControllerCensus);
const backendEndpoints = controllers.flatMap((controller) => controller.endpoints.map((endpoint) => ({
  ...endpoint,
  controller: controller.controller,
  controllerFile: controller.file,
})));
const serviceFiles = walk(backendRoot, (file) => file.endsWith('.service.ts'));
const services = serviceFiles.map(serviceModelCensus).filter((item) => item.models.length);

const frontendCalls = frontend.flatMap((item) => item.apiCalls.map((call) => ({ ...call, frontendFile: item.file })));
const apiBindings = frontendCalls.map((call) => {
  const matches = backendEndpoints.filter((endpoint) => {
    const methodMatches = call.method === 'REQUEST' || call.method === endpoint.method;
    return methodMatches && endpointMatches(call.endpoint, endpoint.path);
  });
  return {
    ...call,
    matches: matches.map((match) => ({
      method: match.method,
      path: match.path,
      controller: match.controller,
      controllerFile: match.controllerFile,
      handler: match.handler,
      permission: match.permission,
      calls: match.calls,
    })),
  };
});

const screenDefinitionsText = fs.readFileSync(path.join(frontendRoot, 'navigation', 'permissions.ts'), 'utf8');
const screenDefinitions = [...screenDefinitionsText.matchAll(/\{\s*id:\s*'([^']+)',\s*code:\s*'([^']+)',\s*label:\s*'([^']+)'/g)]
  .map((match) => ({ id: match[1], code: match[2], label: match[3] }));

const swText = fs.readFileSync(path.join(root, 'frontend', 'public', 'sw.js'), 'utf8');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'frontend', 'public', 'manifest.webmanifest'), 'utf8'));

const artifact = {
  plast: 'PFFV5_PLAST17A',
  generatedAt: new Date().toISOString(),
  mode: 'READ_ONLY_STATIC_CENSUS',
  productFilesChangedByCensus: 0,
  businessDbCreated: 0,
  businessDbMutated: 0,
  businessDbDeleted: 0,
  frontend: {
    sourceFiles: frontend.length,
    screenDefinitions,
    screenFiles: frontend.filter((item) => item.file.includes('/screens/')).map((item) => ({
      ...item,
      reachable: reachable.has(item.file),
    })),
    componentFiles: frontend.filter((item) => item.file.includes('/components/')).map((item) => ({
      ...item,
      reachable: reachable.has(item.file),
    })),
    unreachableSourceFiles: frontend.filter((item) => !reachable.has(item.file)).map((item) => item.file),
    apiCallCount: frontendCalls.length,
    apiCalls: apiBindings,
    presentationLayerCount: frontend.reduce((sum, item) => sum + item.layers.length, 0),
    directNetworkCalls: frontend.flatMap((item) => item.directNetworkCalls.map((call) => ({ ...call, file: item.file }))),
    staticArrays: frontend.flatMap((item) => item.staticArrays.map((array) => ({ ...array, file: item.file }))),
  },
  backend: {
    controllerFiles: controllers.length,
    endpointCount: backendEndpoints.length,
    controllers,
    serviceModelOwners: services,
  },
  bindingSummary: {
    frontendCalls: apiBindings.length,
    callsWithControllerMatch: apiBindings.filter((item) => item.matches.length === 1).length,
    callsWithMultipleMatches: apiBindings.filter((item) => item.matches.length > 1).length,
    callsWithoutMatch: apiBindings.filter((item) => item.matches.length === 0).length,
  },
  pwa: {
    manifestName: manifest.name,
    startUrl: manifest.start_url,
    display: manifest.display,
    cacheNames: [...swText.matchAll(/['"](zavod-[^'"]+)['"]/g)].map((match) => match[1]),
    skipWaiting: /skipWaiting\s*\(/.test(swText),
    clientsClaim: /clients\.claim\s*\(/.test(swText),
    navigationFallback: /offline\.html/.test(swText),
    serviceWorkerVersion: swText.match(/zavod-shell-v\d+/)?.[0] ?? null,
  },
};

fs.mkdirSync(evidenceDir, { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({
  output: relative(outputPath),
  sourceFiles: artifact.frontend.sourceFiles,
  screens: artifact.frontend.screenFiles.length,
  components: artifact.frontend.componentFiles.length,
  apiCalls: artifact.bindingSummary,
  backendEndpoints: artifact.backend.endpointCount,
  unreachable: artifact.frontend.unreachableSourceFiles,
  pwa: artifact.pwa,
}, null, 2));
