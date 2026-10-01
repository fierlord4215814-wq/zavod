const fs = require('node:fs');
const path = require('node:path');

const rootDir = path.resolve(__dirname, '..', '..');
const files = {
  peopleService: path.join(rootDir, 'backend/src/modules/people/people.service.ts'),
  peopleController: path.join(rootDir, 'backend/src/modules/people/people.controller.ts'),
  attachmentsService: path.join(rootDir, 'backend/src/modules/attachments/attachments.service.ts'),
  profilePhotoComponent: path.join(rootDir, 'frontend/src/components/ProfilePhoto.tsx'),
  peopleScreen: path.join(rootDir, 'frontend/src/screens/PeopleScreen.tsx'),
  shiftPeopleScreen: path.join(rootDir, 'frontend/src/screens/ShiftPeopleScreen.tsx'),
};

const ok = [];
const failures = [];

function read(file) {
  return fs.readFileSync(file, 'utf8');
}

function record(name, passed, detail) {
  (passed ? ok : failures).push({ name, ...(detail ? { detail } : {}) });
}

function containsNoSecret(value) {
  return !/DATABASE_URL\s*=|postgres(?:ql)?:\/\/[^<\s"`]+:[^<\s"`]+@|passwordHash|storagePath|JWT_SECRET\s*=|refreshToken|accessToken|authToken/i.test(value);
}

function functionBody(source, name) {
  const start = source.indexOf(name);
  if (start === -1) return '';
  const open = source.indexOf('{', start);
  if (open === -1) return '';
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    const char = source[index];
    if (char === '{') depth += 1;
    if (char === '}') depth -= 1;
    if (depth === 0) return source.slice(open, index + 1);
  }
  return '';
}

function main() {
  const peopleService = read(files.peopleService);
  const peopleController = read(files.peopleController);
  const attachmentsService = read(files.attachmentsService);
  const profilePhotoComponent = read(files.profilePhotoComponent);
  const peopleScreen = read(files.peopleScreen);
  const shiftPeopleScreen = read(files.shiftPeopleScreen);
  const combinedPublicFrontend = [profilePhotoComponent, peopleScreen, shiftPeopleScreen].join('\n');

  record('profile photo endpoints live inside PeopleController', /Post\(':id\/photo'\)/.test(peopleController) && /Delete\(':id\/photo'\)/.test(peopleController));
  record('profile photo upload uses multipart file interceptor', /UseInterceptors\(FileInterceptor\('file'\)\)/.test(peopleController));
  record('backend explicitly blocks self photo changes', /user\.userId === target\.id/.test(peopleService) && /people profile photo self update denied/.test(peopleService));
  record('backend allows only master or higher roles', /UserRole\.MASTER/.test(peopleService) && /UserRole\.MANAGEMENT/.test(peopleService) && /UserRole\.ADMIN/.test(peopleService));
  record('backend keeps factory and department scope checks', /assertTargetScope\(user, target\)/.test(peopleService));
  record('master cannot edit service or leadership photos', /master profile photo target role denied/.test(peopleService) && /UserRole\.WORKER/.test(peopleService) && /UserRole\.CONTRACTOR/.test(peopleService));
  record('profile photo is marked as COMMON profile-photo attachment', /AttachmentEntityType\.COMMON/.test(peopleService) && /profile-photo:\$\{user\.selectedFactoryId\}:\$\{targetUserId\}:/.test(peopleService));
  record('old profile photos are soft-deactivated, not physically deleted', /updateMany\(\{[\s\S]*deletedAt: new Date\(\)/.test(peopleService) && !/unlink|rmSync|rmdir|deleteFile/i.test(peopleService));
  record('profile photo response does not serialize storagePath', /serializeProfilePhoto/.test(peopleService) && !/storagePath/.test(functionBody(peopleService, 'serializeProfilePhoto')));
  record('attachment file guard recognizes only profile-photo COMMON attachments', /validateCommonProfilePhotoAccess/.test(attachmentsService) && /profile-photo:\$\{attachment\.factoryId\}:\$\{attachment\.entityId\}:/.test(attachmentsService));
  record('COMMON non-profile attachments remain forbidden', /unsupported common attachment/.test(attachmentsService));
  record('profile photo component downloads through guarded api client', /apiClient\.downloadBlob\(`\/attachments\/\$\{photo\.id\}\/file`\)/.test(profilePhotoComponent));
  record('frontend does not expose storagePath or secret markers', containsNoSecret(combinedPublicFrontend));
  record('UI uses Russian profile photo labels', /Добавить фото/.test(peopleScreen) && /Заменить/.test(peopleScreen) && /Удалить/.test(peopleScreen) && /Фото ведёт мастер или руководитель/.test(peopleScreen));

  console.log(`\nProfile photo RBAC regression: ${ok.length} passed, ${failures.length} failed`);
  for (const item of ok) console.log(`  OK ${item.name}`);
  for (const item of failures) console.error(`  FAIL ${item.name}`, item.detail ?? '');
  if (failures.length) process.exit(1);
}

main();
