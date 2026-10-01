# Physical Field Fixes V2 — Stage 01

## Итог

- `STAGE01`: **PASS_WITH_P2**.
- `REQUIREMENTS`: `B01-B13`, `C01-C22`, `D01-D15`.
- `P0`: 0.
- `P1`: 0.
- `P2`: физическая проверка системного Android gesture Back и реального pull-down в установленной PWA; автоматизированный browser-контракт и защита состояния прошли.
- Модель данных и migration не менялись.

## Реализовано

### Guest и назначение

- В едином `SCREEN_DEFINITIONS` добавлена отдельная «Главная»; Guest видит только «Главная» и «Сообщить об ошибке», без «Ещё», объявлений и рабочих разделов.
- Карточка назначения перенесена на Guest Home и больше не выводится над каждым экраном.
- `/auth/assignment-request` возвращает один server-provided список атомарных назначений. Каждый вариант связывает роль/должность, подразделение либо фирму и содержит непрозрачный hash id.
- POST принимает только `assignmentOptionId`; раздельные `requestedRole`, `departmentId`, `companyId`, подделанный id и diagnostic/self-escalation варианты запрещены backend.
- Существующие reviewer guards, department/company/factory scope, idempotency, audit и live auth refresh переиспользованы без ослабления.

### Startup, navigation и Back

- Fresh/cold session открывает role-home: Guest — «Главная», MASTER/WORKER — «Смена».
- Текущий разрешённый route и scroll восстанавливаются только в той же session и только для того же user/factory; logout очищает session state, смена завода сбрасывает несовместимый route.
- Back coordinator сначала снимает focus/клавиатуру, затем закрывает верхний layer, затем возвращает по route history. Exit dialog появляется только на корневом role-home.
- Sheet «Настройки» возвращается в «Ещё» первым Back, а не закрывает оба уровня сразу.
- Черновики гостевой заявки и «Сообщить об ошибке» восстанавливаются в текущей session; файлы и секреты в storage не сохраняются.

### PWA, menu slots и badges

- Standalone shell получает `overscroll-behavior-y: none`, обычная вертикальная прокрутка сохраняется.
- PWA update при dirty form требует штатное приложение-confirm modal.
- Быстрые разделы автоматически заполняются из единого menu catalog; в настройках можно выбрать три свободных слота, role-home закреплён.
- Guest имеет ровно две нижние кнопки без settings/more.
- Bottom nav и More используют один `badgeForScreen`: Notifications, Announcements, Chats и Tasks. Нули скрыты; counts загружаются только для разрешённых routes из уже scoped API.

## Canonical sources reused

- Frontend: `frontend/src/navigation/permissions.ts`, `frontend/src/navigation/mobile-back.ts`, `frontend/src/App.tsx`, `frontend/src/store/app.store.ts`.
- Backend: существующие `AuthService`, `AdminService` reviewer guards, `AssignmentRequest`, `UserFactoryAccess`, role permissions и audit.
- Design: `frontend/src/styles.css` и существующие Industrial Premium 10F tokens; второй theme/menu/back/badge контур не создавался.

## Изменённые файлы

- `backend/src/modules/auth/auth.service.ts`
- `backend/scripts/pilot-fix-plast2-regression.js`
- `backend/scripts/physical-field-fixes-v2-stage01-regression.js`
- `backend/package.json`
- `frontend/src/App.tsx`
- `frontend/src/store/app.store.ts`
- `frontend/src/navigation/permissions.ts`
- `frontend/src/navigation/mobile-back.ts`
- `frontend/src/components/GuestAssignmentRequestCard.tsx`
- `frontend/src/screens/GuestHomeScreen.tsx`
- `frontend/src/screens/BugReportScreen.tsx`
- `frontend/src/styles.css`
- `frontend/e2e/guest-rbac-menu.spec.ts`
- `frontend/e2e/pilot-fix-plast2.spec.ts`
- `frontend/e2e/physical-field-fixes-v2-stage01.spec.ts`
- `frontend/package.json`

## Targeted tests

- Backend build: PASS.
- Frontend build: PASS; только известное предупреждение Vite о размере chunk.
- `physical-field-fixes:v2-stage01-regression`: PASS, 13/13.
- `pilot-fix:plast2-regression`: PASS; атомарная заявка, department/company/factory isolation, stale/idempotency и live role refresh.
- `guest:rbac-menu-e2e`: PASS, desktop + mobile 360/390/430.
- `pilot-fix:plast2-e2e`: PASS, desktop + mobile; accept/reject и исчезновение заявки у reviewer.
- `physical-field-fixes:v2-stage01-e2e`: PASS, 4/4 desktop/mobile; role-home, session reload, role switch, draft, keyboard-first Back, sheet Back, quick slots и overflow.
- Pilot-pack после mutating E2E восстановлен штатным idempotent `pilot-pack:v1`.

## Mobile evidence

- 360/390/430: PASS, horizontal overflow отсутствует.
- Keyboard-first Back: PASS в Playwright.
- Multi-step sheet Back: PASS.
- Screenshots: `docs/physical-field-fixes-v2-screenshots/stage01/guest-mobile-360.png`, `master-mobile-390.png`.
- Physical Android/PWA: `PENDING`.

## Security

- Guest announcement API: 403.
- Legacy/tampered assignment body: 403.
- Чужой отдел/фирма/завод и ordinary reviewer: deny подтверждён.
- Секреты, `storagePath`, `passwordHash` в ответах/скриншотах не обнаружены.
- Browser `prompt/alert/confirm` не добавлялись.

## Runtime

- Backend: `http://127.0.0.1:3000/health`, PID `12408`, status `ok`.
- Frontend: `http://127.0.0.1:5173`, существующий preview PID `6588`, HTTP 200.
- Оба процесса оставлены запущенными для следующего этапа.

`PHYSICAL_PHONE_GATE`: **PENDING**.

`NEXT_SAFE_STAGE`: **02**.
