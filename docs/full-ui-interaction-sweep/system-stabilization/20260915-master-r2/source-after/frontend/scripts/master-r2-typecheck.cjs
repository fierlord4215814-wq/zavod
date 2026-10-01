// Genuine application graph diagnostics; no transpile-only or declaration shims.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const ts = require('typescript');
const root = path.resolve(__dirname, '../..');
const configPath = path.join(root, 'frontend/tsconfig.json');
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const relative = file => path.relative(root, file).replaceAll('\\', '/');
const input = ts.readConfigFile(configPath, ts.sys.readFile);
if (input.error) throw new Error(ts.flattenDiagnosticMessageText(input.error.messageText, '\n'));
const config = ts.parseJsonConfigFileContent(input.config, ts.sys, path.dirname(configPath));
const program = ts.createProgram(config.fileNames, config.options);
const diagnostics = [...config.errors, ...ts.getPreEmitDiagnostics(program)].map(d => {
  const position = d.file && d.start != null ? d.file.getLineAndCharacterOfPosition(d.start) : null;
  const message = ts.flattenDiagnosticMessageText(d.messageText, '\n');
  const file = d.file ? relative(d.file.fileName) : null;
  return { file, line: position ? position.line + 1 : null, column: position ? position.character + 1 : null,
    start: d.start, length: d.length, code: d.code, category: ts.DiagnosticCategory[d.category], message,
    semanticKey: sha(JSON.stringify([file, d.code, message, d.file && d.start != null ? d.file.text.slice(d.start, d.start + (d.length || 0)) : ''])) };
});
const sources = program.getSourceFiles().map(f => ({ file: relative(f.fileName), declaration: f.isDeclarationFile,
  bytes: Buffer.byteLength(f.text), sha256: sha(f.text) })).sort((a,b) => a.file.localeCompare(b.file));
const report = { at: new Date().toISOString(), compiler: ts.version, scope: 'full frontend/src application graph; e2e/configs separate',
  configSha256: sha(fs.readFileSync(configPath)), options: config.options,
  roots: config.fileNames.map(relative).sort(), sources, diagnostics,
  errors: diagnostics.filter(d => d.category === 'Error').length };
const output = process.env.R2_TYPE_REPORT;
if (output) {
  const target = path.resolve(root, output);
  const allowed = path.join(root, 'docs/full-ui-interaction-sweep/system-stabilization/20260915-master-r2') + path.sep;
  if (!target.startsWith(allowed) || !target.endsWith('.json')) throw new Error('Scoped R2 report path required');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, JSON.stringify(report, null, 2), { flag: 'wx' });
}
for (const d of diagnostics) console.log(`${d.file || 'config'}(${d.line || 0},${d.column || 0}): ${d.category} TS${d.code}: ${d.message}`);
console.log(JSON.stringify({ compiler: report.compiler, configSha256: report.configSha256, roots: report.roots.length,
  graphFiles: sources.length, applicationFiles: sources.filter(s => s.file.startsWith('frontend/src/')).length, errors: report.errors }));
process.exitCode = report.errors ? 1 : 0;
