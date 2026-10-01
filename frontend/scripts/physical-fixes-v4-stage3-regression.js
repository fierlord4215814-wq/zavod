const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');
const shiftPeople = read('src/screens/ShiftPeopleScreen.tsx');
const styles = read('src/styles.css');
const scrollLock = read('src/hooks/useBodyScrollLock.ts');
const actionModal = read('src/components/ActionModal.tsx');
const confirmDialog = read('src/components/AppConfirmDialog.tsx');
const attachmentPreview = read('src/components/AttachmentPreviewList.tsx');
const app = read('src/App.tsx');
const chats = read('src/screens/ChatsScreen.tsx');

const results = [];
function check(name, condition) {
  results.push({ name, passed: Boolean(condition) });
  console.log(`${condition ? 'PASS' : 'FAIL'}: ${name}`);
}

check(
  'canonical scroll lock is reference-counted',
  /const activeLocks = new Set<symbol>\(\)/.test(scrollLock)
    && /activeLocks\.add\(key\)/.test(scrollLock)
    && /activeLocks\.delete\(key\)/.test(scrollLock),
);
check(
  'canonical scroll lock restores exact body, html and scroll state',
  /bodyPosition/.test(scrollLock)
    && /bodyOverflow/.test(scrollLock)
    && /htmlOverflow/.test(scrollLock)
    && /window\.scrollTo\(\{ top: current\.scrollY, left: 0, behavior: 'auto' \}\)/.test(scrollLock),
);
check(
  'shared modal surfaces use the canonical scroll lock',
  [actionModal, confirmDialog, attachmentPreview, app, chats, shiftPeople]
    .every((source) => /useBodyScrollLock/.test(source)),
);
check(
  'person-first assignment opens a dedicated slot picker',
  /data-testid="person-first-slot-picker"/.test(shiftPeople)
    && /Человек выбран\. Нажатие на свободный слот назначит его сразу\./.test(shiftPeople),
);
check(
  'slot-first assignment opens a compact person picker',
  /data-testid="slot-first-person-picker"/.test(shiftPeople)
    && /assignment-person-sheet/.test(shiftPeople)
    && /Найти не отметившегося сотрудника/.test(shiftPeople),
);
check(
  'both line assignment directions call the same backend command',
  (shiftPeople.match(/postCurrentShiftAction\('\/assignments\/line'/g) ?? []).length >= 2,
);
check(
  'work area shows explicit slots and shortage summary',
  /aria-label="Сводка по рабочей зоне"/.test(shiftPeople)
    && /<small>Требуется<\/small>/.test(shiftPeople)
    && /<small>Назначено<\/small>/.test(shiftPeople)
    && /<small>Свободно<\/small>/.test(shiftPeople)
    && /Позиции и слоты/.test(shiftPeople),
);
check(
  'work area person-first uses one-tap direct assignment',
  /void assignCandidateToWorkArea\(assignmentFlowUser\.userId, slot\.workAreaPositionId, slot\.slotIndex\)/.test(shiftPeople),
);
check(
  'requirement changes use a separately labelled guarded modal',
  /id="requirement-editor-title">Изменить потребность/.test(shiftPeople)
    && /Сохранить потребность/.test(shiftPeople)
    && /Занятые текущие и будущие слоты защищены backend/.test(shiftPeople),
);
check(
  'persistent slot controls are replaced by a requirement action',
  /slot-plan-controls/.test(shiftPeople)
    && /Изменить потребность/.test(shiftPeople)
    && !/aria-label="Увеличить план позиции"/.test(shiftPeople),
);
check(
  'assignment sheets have bounded mobile dimensions and sticky actions',
  /--premium-assignment-sheet-width/.test(styles)
    && /--premium-assignment-sheet-height/.test(styles)
    && /\.assignment-person-sheet/.test(styles)
    && /\.assignment-person-sheet \.assignment-person-list\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/s.test(styles)
    && /\.sticky-actions/.test(styles),
);
check(
  'future KPI cards use compact stable dimensions',
  /--premium-compact-kpi-height/.test(styles)
    && /\.premium-kpi-strip\.future-plan-metrics/.test(styles)
    && /\.future-plan-metrics \.premium-kpi-icon/.test(styles),
);
check(
  'changed UI does not use browser prompt alert or confirm',
  !/\b(?:window\.)?(?:prompt|alert|confirm)\s*\(/.test(
    [shiftPeople, scrollLock, actionModal, confirmDialog, attachmentPreview, app, chats].join('\n'),
  ),
);

const failed = results.filter((result) => !result.passed);
console.log(`\nPhysical Fixes V4 Stage3: ${results.length - failed.length} passed, ${failed.length} failed`);
process.exitCode = failed.length ? 1 : 0;
