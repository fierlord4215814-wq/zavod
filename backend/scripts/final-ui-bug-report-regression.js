const fs = require('node:fs');
const path = require('node:path');

const rootDir = path.resolve(__dirname, '..', '..');
const files = {
  appModule: path.join(rootDir, 'backend/src/app.module.ts'),
  module: path.join(rootDir, 'backend/src/modules/error-report/error-report.module.ts'),
  controller: path.join(rootDir, 'backend/src/modules/error-report/error-report.controller.ts'),
  service: path.join(rootDir, 'backend/src/modules/error-report/error-report.service.ts'),
  app: path.join(rootDir, 'frontend/src/App.tsx'),
  navigation: path.join(rootDir, 'frontend/src/navigation/permissions.ts'),
  screen: path.join(rootDir, 'frontend/src/screens/BugReportScreen.tsx'),
  styles: path.join(rootDir, 'frontend/src/styles.css'),
};

const ok = [];
const failures = [];

function read(file) {
  return fs.readFileSync(file, 'utf8');
}

function record(name, passed, detail) {
  (passed ? ok : failures).push({ name, ...(detail ? { detail } : {}) });
}

function functionBody(source, name) {
  const start = source.indexOf(name);
  if (start === -1) return '';
  const open = source.indexOf('{', start);
  if (open === -1) return '';
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') depth -= 1;
    if (depth === 0) return source.slice(open, index + 1);
  }
  return '';
}

function hasNoSecretLeak(source) {
  return !/postgres(?:ql)?:\/\/[^<\s"`]+:[^<\s"`]+@|passwordHash|storagePath|refreshToken|accessToken|authToken/i.test(source);
}

function main() {
  const appModule = read(files.appModule);
  const moduleSource = read(files.module);
  const controller = read(files.controller);
  const service = read(files.service);
  const app = read(files.app);
  const navigation = read(files.navigation);
  const screen = read(files.screen);
  const styles = read(files.styles);

  record('ErrorReportModule is registered in AppModule', /ErrorReportModule/.test(appModule));
  record('error report endpoints include create, admin list, detail and status', /Controller\('error-reports'\)/.test(controller) && /@Post\(\)/.test(controller) && /@Get\(\)/.test(controller) && /@Get\(':id'\)/.test(controller) && /@Patch\(':id\/status'\)/.test(controller));
  record('error report module uses existing Prisma and attachment foundations', /PrismaService/.test(service) && /AttachmentsService/.test(service) && /AttachmentEntityType\.ERROR_REPORT/.test(service));
  record('error reports use external file export package service', /ErrorReportFileExportService/.test(service) && /writeFileExport\(report\.id\)/.test(service));
  record('file export package supports runtime path, html, txt, manifest and attachments', /ERROR_REPORTS_EXPORT_PATH/.test(read(path.join(rootDir, 'backend/src/modules/error-report/error-report-file-export.service.ts'))) && /report\.html/.test(read(path.join(rootDir, 'backend/src/modules/error-report/error-report-file-export.service.ts'))) && /manifest\.json/.test(read(path.join(rootDir, 'backend/src/modules/error-report/error-report-file-export.service.ts'))) && /attachments\//.test(read(path.join(rootDir, 'backend/src/modules/error-report/error-report-file-export.service.ts'))));
  record('sensitive values are redacted before writing report text', /redactSensitiveText\(/.test(service) && /DATABASE_URL/.test(service) && /passwordHash/.test(service));
  record('public API returns report id and human success message, not local file path', /Ошибка отправлена администратору/.test(service) && /id: report\.id/.test(service) && !/filePath/.test(functionBody(service, 'return')));
  record('admin list is backend-guarded to ADMIN only', /assertAdmin\(user\)/.test(service) && /Список сообщений об ошибках доступен только администратору/.test(service));
  record('ordinary owner can only open own report detail', /const isOwner = report\.authorId === user\.userId/.test(service) && /Нет доступа к этому сообщению/.test(service));
  record('schema supports in-app error report and guarded attachments', /model ErrorReport/.test(read(path.join(rootDir, 'backend/prisma/schema.prisma'))) && /ERROR_REPORT/.test(read(path.join(rootDir, 'backend/prisma/schema.prisma'))));
  record('canonical navigation adds the report item as the last visible screen', /id: 'Report'/.test(navigation) && /label: 'Сообщить об ошибке'/.test(navigation));
  record('report screen is available without special permission', /report:\s*\[\]/.test(navigation) && /required\.length === 0/.test(navigation));
  record('frontend posts to /error-reports and uploads ERROR_REPORT attachments', /apiClient\.post<ReportResponse>\('\/error-reports'/.test(screen) && /uploadAttachments\('ERROR_REPORT'/.test(screen));
  record('frontend keeps user id only in the private draft key and renders human role/factory context', /const draftKey = `zavod\.session\.error-report\.\$\{currentUser\?\.userId/.test(screen) && /roleLabel\(currentUser\?\.role\)/.test(screen) && /Автор, роль \(\{currentRoleLabel\}\), завод \(\{selectedFactory\?\.name/.test(screen));
  record('ADMIN-only UI lists reports and changes status', /const isAdmin = Boolean\(currentUser\?\.isAdmin\)/.test(screen) && screen.includes('/error-reports/${report.id}/status'));
  record('report action is disabled while saving', /disabled=\{!canSubmit\}/.test(screen) && /busy/.test(screen));
  record('mobile report form styles exist', /bug-report-screen/.test(styles) && /bug-report-context/.test(styles));
  record('new public bug report code does not expose storage paths or secrets', hasNoSecretLeak([controller, screen, navigation].join('\n')));

  console.log(`\nFinal UI bug report regression: ${ok.length} passed, ${failures.length} failed`);
  for (const item of ok) console.log(`  OK ${item.name}`);
  for (const item of failures) console.error(`  FAIL ${item.name}`, item.detail ?? '');
  if (failures.length) process.exit(1);
}

main();
