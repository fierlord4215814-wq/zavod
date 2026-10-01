const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..', '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const peopleService = read('backend/src/modules/people/people.service.ts');
const peopleController = read('backend/src/modules/people/people.controller.ts');
const policy = read('backend/src/common/publication-policy.ts');
const announcementService = read('backend/src/modules/announcements/announcements.service.ts');
const announcementScreen = read('frontend/src/screens/AnnouncementsScreen.tsx');
const returnService = read('backend/src/modules/returns/returns.service.ts');
const returnScreen = read('frontend/src/screens/ReturnsScreen.tsx');
const picker = read('frontend/src/components/CompactPeoplePicker.tsx');
const admin = read('frontend/src/screens/AdminConfigScreen.tsx');
const navigation = read('frontend/src/navigation/permissions.ts');
const types = read('frontend/src/store/app.store.ts');
const css = read('frontend/src/styles.css');
const schema = read('backend/prisma/schema.prisma');
const migration = read('backend/prisma/migrations/20260728110000_physical_fixes_v4_publication_feeds/migration.sql');

let passed = 0;
let failed = 0;

function record(name, condition) {
  if (condition) {
    passed += 1;
    console.log(`PASS: ${name}`);
  } else {
    failed += 1;
    console.error(`FAIL: ${name}`);
  }
}

record('phone visibility has one canonical backend role matrix',
  /const FACTORY_PHONE_ROLES = new Set<UserRole>/.test(peopleService)
  && /UserRole\.OTHER/.test(peopleService)
  && /UserRole\.CONTRACTOR_LEAD/.test(peopleService)
  && /FACTORY_PHONE_ROLES\.has\(user\.role as UserRole\)/.test(peopleService));
record('phone DTO policy is not frontend-only',
  /phone:\s*canReadPhone \?/.test(peopleService)
  && /phoneLabel:\s*canReadPhone \?/.test(peopleService));
record('people controller reaches service-level role and scope checks',
  !/@Get\(\)\s*\r?\n\s*@RequirePermission/.test(peopleController)
  && /assertTargetScope\(user, target\)/.test(peopleService)
  && /people company scope denied/.test(peopleService));
record('delegation picker can show complete server list immediately',
  /showAllInitially\?: boolean/.test(picker)
  && /if \(showAllInitially && !hasQuery\) return items/.test(picker)
  && /<CompactPeoplePicker[\s\S]{0,180}showAllInitially/.test(admin));
record('delegation search remains a filter and selection stays explicit',
  /items\.filter/.test(picker)
  && /className=\{`compact-person-choice/.test(picker)
  && /actionLabel="Выбрать"/.test(admin));

record('announcement publisher policy includes service and lead roles but excludes basic workers',
  /ANNOUNCEMENT_PUBLISHER_ROLES/.test(policy)
  && /UserRole\.MASTER/.test(policy)
  && /UserRole\.OTHER/.test(policy)
  && /UserRole\.TECH_KIPIA/.test(policy)
  && /UserRole\.CONTRACTOR_LEAD/.test(policy)
  && !/ANNOUNCEMENT_PUBLISHER_ROLES[\s\S]{0,500}UserRole\.WORKER/.test(policy));
record('announcement create button is visible on the main screen',
  /announcement-main-create/.test(announcementScreen)
  && /Создать объявление/.test(announcementScreen));
record('announcement UI supports all, own and selected department audiences',
  /'FACTORY' \| 'MY_DEPARTMENT' \| 'SELECTED'/.test(announcementScreen)
  && /Весь завод/.test(announcementScreen)
  && /Мой отдел/.test(announcementScreen)
  && /Выбранные отделы/.test(announcementScreen)
  && /departmentIds/.test(announcementScreen));
record('selected audience cannot be submitted empty in UI and backend',
  /Выберите хотя бы один отдел/.test(announcementScreen)
  && /if \(!departmentIds\.length\) throw new ConflictError\('Выберите хотя бы один отдел\.'\)/.test(announcementService));
record('multi-department audience keeps soft history',
  /model AnnouncementDepartment/.test(schema)
  && /isActive\s+Boolean/.test(schema)
  && /deactivatedAt\s+DateTime\?/.test(schema)
  && /syncAudienceDepartments/.test(announcementService)
  && /isActive: false, deactivatedAt: new Date\(\)/.test(announcementService));
record('announcement DTO exposes concise audience labels',
  /audienceType/.test(types)
  && /audienceDepartments/.test(types)
  && /scopeLabel/.test(announcementService));

record('returns screen is a publication feed rather than a task workflow',
  /Опубликовать возврат/.test(returnScreen)
  && /Публикация/.test(returnScreen)
  && !/mark-completion|Отметить выполнение|Полностью заверш/.test(returnScreen));
record('return card and detail contain required publication fields',
  /Фотография продукции/.test(returnScreen)
  && /Краткая причина/.test(returnScreen)
  && /Артикул:/.test(returnScreen)
  && /Количество:/.test(returnScreen)
  && /Автор:/.test(returnScreen)
  && /Линия/.test(returnScreen));
record('return backend enforces publisher roles and factory-scoped line',
  /RETURN_PUBLISHER_ROLES/.test(policy)
  && /assertCanPublish/.test(returnService)
  && /assertLineAvailable/.test(returnService)
  && /factoryId: user\.selectedFactoryId/.test(returnService));
record('all assigned non-guest employees can read return publications',
  /canReadReturnPublications/.test(policy)
  && /return !user\.isGuest/.test(policy)
  && /screenCode === 'returns'\) return true/.test(navigation));
record('return DTO carries unit, line, author and guarded attachments',
  /unit\?: string/.test(types)
  && /line\?: \{ id: string; name: string \}/.test(types)
  && /author\?:/.test(types)
  && /attachments\?: Attachment\[\]/.test(types));
record('Stage 5 migration is additive-only',
  /CREATE TABLE "AnnouncementDepartment"/.test(migration)
  && /ADD COLUMN "unit"/.test(migration)
  && /ADD COLUMN "lineId"/.test(migration)
  && !/\b(?:DROP|TRUNCATE|DELETE\s+FROM)\b/i.test(migration));
record('new audience and return controls are mobile responsive',
  /\.announcement-audience-modes/.test(css)
  && /\.returns-publication-card/.test(css)
  && /@media \(max-width: 430px\)[\s\S]*returns-publication-card/.test(css));
record('changed Stage 5 UI has no browser prompt alert or confirm',
  !/\b(?:window\.)?(?:prompt|alert|confirm)\s*\(/.test(`${announcementScreen}\n${returnScreen}\n${picker}`));
record('public DTO declarations do not expose protected storage fields',
  !/\b(?:storagePath|passwordHash|DATABASE_URL|accessToken|refreshToken)\b/.test(`${types}\n${announcementScreen}\n${returnScreen}`));

console.log(`\nPhysical Fixes V4 Stage5 UI: ${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
