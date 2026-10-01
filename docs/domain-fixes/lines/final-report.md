# Lines domain fix: final report

## Итог

`LINES_FIX_STATUS: PASS`

- P0: 0
- P1: 0
- P2_OPEN: LINE-015
- P3_OPEN: LINE-016, LINE-018
- MIGRATION: NOT_REQUIRED
- RESOLVED: 16/16

## Что изменено

Backend:

- Добавлен общий presentation/validation helper причин простоя.
- Line read-model различает RUNNING, DOWNTIME, WASH, DEFROST и STOPPED.
- Effective permissions являются окончательным authority для read/mutation; hardcoded MASTER/MANAGEMENT bypass удалён.
- Public permission error не раскрывает capability code.
- Timeline, Archive и Ops используют единые reason labels и сохраняют отдельный комментарий.
- Деактивированная линия остаётся доступна в авторизованной read-only истории.
- `Line.version` используется как optimistic precondition; несовместимый проигравший запрос получает 409.

Frontend:

- DEFROST имеет отдельную карточку, KPI и корректный переход в существующий workflow.
- Оба line entry surface получают причины с backend.
- Время и datetime input основаны на factory/server time.
- ActionModal показывает busy, 409 и network error; повторный tap не создаёт второй запрос.
- Shared mobile Back закрывает top layer в browser/PWA, parent detail восстанавливается.
- «Статистика» переименована в «Текущее состояние».
- Использована существующая Industrial Premium 10F система; второй style/theme contour не создавался.

## Изменённые product-файлы

- `backend/src/common/downtime-reason.ts`
- `backend/src/common/permission.guard.ts`
- `backend/src/modules/line/line.controller.ts`
- `backend/src/modules/line/line.service.ts`
- `backend/src/modules/line/line-timeline.ts`
- `backend/src/modules/archive/archive.service.ts`
- `backend/src/modules/ops/ops.service.ts`
- `frontend/src/utils/factory-time.ts`
- `frontend/src/store/app.store.ts`
- `frontend/src/screens/SituationScreen.tsx`
- `frontend/src/screens/ShiftPeopleScreen.tsx`
- `frontend/src/navigation/mobile-back.ts`
- `frontend/src/styles.css`

Targeted regression/harness:

- `backend/scripts/line-timeline-regression.js`
- `backend/scripts/physical-field-fixes-v5-plast1-regression.js`
- `.codex-runtime/line-domain-audit/lines-domain-audit.js`
- `.codex-runtime/line-domain-fix/targeted-backend.js`
- `.codex-runtime/line-domain-fix/browser-e2e.js`

## Проверки

- Controlled backend audit/recheck: `41/41`, gaps `0`.
- Targeted backend: `16/16`.
- Cohesive browser E2E: `31/31` (desktop 1440; mobile 360/390/430; Moscow/Los Angeles; browser/PWA Back).
- Line timeline: `34/34`.
- Lines/Wash/Defrost compact lifecycle: `21/21`.
- Line card/detail: `29/29`.
- Shift assignment capability: `25/25`.
- Security/privacy affected subset: `17/17`.
- Realtime line compact smoke: `19/19`.
- Backend build: PASS.
- Frontend build: PASS; только известный Vite warning о chunk > 500 kB.
- Prisma validate: PASS.
- Prisma migrate status: 53 migrations, schema up to date.
- Product tree `git diff --check` без generated `node_modules`: PASS.
- Changed scripts `node --check`: PASS.
- Browser prompt/alert/confirm calls: NONE.
- Mojibake: новых дефектов нет; найденные сигнатуры в Archive являются существующей защитой декодирования.
- Public API/browser samples: `storagePath`, `passwordHash`, credentials и secret values не раскрыты.

Полный repo-wide `git diff --check` отдельно видит trailing whitespace в уже tracked generated `node_modules/.prisma/client`; эти generated-файлы не относятся к текущему изменению и не редактировались.

## Controlled cleanup

- ACTIVE_MARKER_LINES: 0
- OPEN_MARKER_EVENTS: 0
- ACTIVE_MARKER_ASSIGNMENTS: 0
- ACTIVE_MARKER_TASKS: 0
- ACTIVE_MARKER_WASHES: 0
- ACTIVE_MARKER_DEFROSTS: 0
- PHYSICAL_DELETES: 0
- PREEXISTING_CHANGED: 0
- Factory 4 protected hash before/after: одинаковый.
- Product source hash before/after: одинаковый.

## Screenshots

- `01-active-defrost-correct-line-card.png`
- `02-defrost-valid-action.png`
- `03-downtime-reason-modal.png`
- `04-visible-network-error.png`
- `05-timeline-comment-history.png`
- `06-mobile-child-layer-back.png`

## Остаток

LINE-015 остаётся P2: immutable historical labels требуют отдельного продуктового решения и, возможно, snapshot contract. LINE-016 и LINE-018 остаются P3. Они не блокируют закрытие 16 заявленных gaps.

`NEXT: PEOPLE AUDIT NOT STARTED`

