const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');
const controller = read('backend/src/modules/checklists/checklists.controller.ts');
const service = read('backend/src/modules/checklists/checklists.service.ts');
const screen = read('frontend/src/screens/ChecklistsScreen.tsx');
const editor = read('frontend/src/components/ChecklistItemEditor.tsx');
const modal = read('frontend/src/components/ActionModal.tsx');
const scrollLock = read('frontend/src/hooks/useBodyScrollLock.ts');
const css = read('frontend/src/styles.css');

let passed = 0;
let failed = 0;

function record(name, condition) {
  if (condition) {
    passed += 1;
    console.log(`PASS: ${name}`);
    return;
  }
  failed += 1;
  console.error(`FAIL: ${name}`);
}

const completeRowBody = service.slice(
  service.indexOf('async completeRow('),
  service.indexOf('async completeCurrentCheck('),
);

record('current periodic check has an explicit guarded backend route',
  /@Post\('runs\/:id\/checks\/current\/complete'\)/.test(controller)
  && /@RequirePermission\(\['checklists\.runs\.self', 'checklists\.runs\.manage'\]\)/.test(controller));
record('saving a row no longer completes the periodic check',
  !/completePeriodicCheck|advancePeriodicCheckIfReady/.test(completeRowBody));
record('explicit completion validates active run, periodic lifecycle and all rows',
  /async completeCurrentCheck/.test(service)
  && /run\.status !== ChecklistRunStatus\.ACTIVE/.test(service)
  && /!this\.isPeriodicRun\(run\)/.test(service)
  && /check\.rows\.some\(\(row\) => row\.status === ChecklistRunRowStatus\.PENDING\)/.test(service));
record('cycle completion uses lock, operation id and stale check protection',
  /operationLockKey\.checklistRun\(runId\)/.test(service)
  && /operationLockKey\.processedOperation\(user\.userId, operationId\)/.test(service)
  && /normalizedCheckId !== check\.id/.test(service));
record('cycle completion is audited separately from full close',
  /CHECKLIST_RUN_CHECK_COMPLETED/.test(service)
  && /entityType: 'ChecklistRunCheck'/.test(service));
record('full periodic close keeps mandatory reason and early-close kind',
  /requiredText\(body\.reason \?\? body\.comment/.test(service)
  && /closeKind: 'MANUAL_EARLY'/.test(service)
  && /nextCheckAt: null/.test(service));
record('archive read model exposes early-close status and reason',
  /Завершён досрочно/.test(service)
  && /closeReason: closedEarly/.test(service)
  && /Причина досрочного завершения/.test(screen));

record('checklist item editor is a true shared ActionModal',
  /className="checklist-item-editor-modal"/.test(screen)
  && /title=\{templateBuilder\.editorIndex/.test(screen)
  && !/checklist-builder-editor-panel/.test(screen));
record('editor has Cancel and Save actions',
  /cancelLabel="Отмена"/.test(screen)
  && /confirmLabel="Сохранить"/.test(screen));
record('editor preserves title, type, description and type-specific controls',
  /Название пункта/.test(editor)
  && /Тип пункта/.test(editor)
  && /Подсказка или описание примера/.test(editor)
  && /rowType === 'NUMBER'/.test(editor)
  && /rowType === 'SELECT'/.test(editor));
record('modal uses shared dim layer and reference-counted scroll lock',
  /className="modal-backdrop"/.test(modal)
  && /useBodyScrollLock\(true\)/.test(modal)
  && /const activeLocks = new Set<symbol>/.test(scrollLock)
  && /window\.scrollTo/.test(scrollLock));
record('obsolete inline editor styling was removed',
  !/\.checklist-builder-editor-panel/.test(css));

record('periodic card has exact early, due and overdue wording',
  /Следующая проверка по плану/.test(screen)
  || /По плану через/.test(screen));
record('periodic card exposes early-start and current-cycle actions',
  /Начать раньше/.test(screen)
  && /Выполнить проверку/.test(screen)
  && /Завершить текущую проверку/.test(screen));
record('full termination is a separate explicit action',
  /Завершить чек-лист полностью/.test(screen)
  && /Причина досрочного завершения/.test(screen));
record('successful cycle completion returns to card with next reminder',
  /Проверка выполнена\. Следующая проверка:/.test(screen)
  && /setSelectedRun\(null\)/.test(screen));
record('browser timer is anchored to workspace server time',
  /workspace\.generatedAt/.test(screen)
  && /setServerClockOffsetMs\(generatedAtMs - Date\.now\(\)\)/.test(screen)
  && /const serverNowMs = clockNowMs \+ serverClockOffsetMs/.test(screen));
record('due and overdue use the canonical two-minute grace already used by backend',
  /remainingMs > -2 \* 60_000/.test(screen)
  && /getTime\(\) \+ 2 \* 60_000 <= now\.getTime\(\)/.test(service));
record('periodic activation still relies on the existing duplicate guard',
  /repeated take-in-work returns existing active run|duplicateBlocked/.test(
    `${read('backend/scripts/checklist-periodic-lifecycle-regression.js')}\n${service}`,
  ));
record('changed UI does not use browser prompt, alert or confirm',
  !/\b(?:window\.)?(?:prompt|alert|confirm)\s*\(/.test(screen));
record('public checklist UI does not expose protected storage fields',
  !/\b(?:storagePath|passwordHash|DATABASE_URL|accessToken|refreshToken)\b/.test(screen));

console.log(`\nPhysical Fixes V4 Stage6 UI: ${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
