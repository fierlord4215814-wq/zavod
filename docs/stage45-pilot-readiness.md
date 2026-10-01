# Stage 45 — готовность к пилоту

## Discovery result

На момент Stage45 уже есть:

- release/runbook документы: `docs/release-readiness.md`, `docs/local-runbook.md`, `docs/run-full-regression-gate.md`, `docs/admin-install-checklist.md`;
- Stage30 release readiness regression и wrapper полного gate;
- Playwright browser e2e Stage31–44;
- backend regressions Stage6–44;
- guarded attachments/archive endpoints;
- `/health` и `/version`, которые не должны отдавать секреты;
- seed-пользователи для ролей пилота.

Stage45 не добавляет бизнес-функции. Это слой подготовки к ручному тесту: hygiene тестовых данных, быстрый/полный gate, чеклисты пилота и демонстрации.

## Fixture hygiene

Добавлен `backend/scripts/stage45-fixture-hygiene.js`.

Правила:

- dry-run включён по умолчанию;
- apply разрешён только с конкретным маркером, например `--stage Stage45 --apply`;
- непомеченные записи не трогаются;
- physical delete не используется;
- для сущностей с архивом используется archive/deactivate/soft-delete;
- `LineEvent` не очищается автоматически, потому что это история без поля soft-delete. Такие события остаются в истории и учитываются только как marked history.
- текущая dev/regression база может содержать много старых `Stage*` fixtures. Широкий dry-run показывает объём, но apply нужно запускать поэтапно: `Stage43`, `Stage44`, `Stage45` и т.д.

Примеры:

```powershell
npm.cmd run stage45:fixture-hygiene --workspace backend
node backend/scripts/stage45-fixture-hygiene.js --stage Stage45 --apply
```

## Regression DB strategy

Рекомендуемая схема:

- `zavod_dev` — ручная разработка и локальная проверка;
- `zavod_regression` — автоматические backend/Playwright regression;
- future `zavod_staging` или `zavod_pilot` — отдельная база перед реальным пилотом.

Правила:

- seed должен быть idempotent;
- migrations на production-like окружениях только `deploy/status`, без reset;
- e2e/regression записи получают маркер `StageXX` и `operationId` вида `stageXX-*`;
- cleanup реальных данных запрещён.

## Quick pilot gate

Добавлен wrapper `backend/scripts/stage45-full-pilot-gate.js`.

Быстрый список:

```powershell
npm.cmd run db:doctor --workspace backend
npm.cmd run prisma:validate --workspace backend
npm.cmd run prisma:generate --workspace backend
npm.cmd run prisma:migrate:status --workspace backend
npm.cmd run build --workspace backend
npm.cmd run build --workspace frontend
npm.cmd run stage45:pilot-readiness-regression --workspace backend
npm.cmd run stage45:browser-e2e
npm.cmd run stage44:checklist-builder-guided-run-regression --workspace backend
npm.cmd run stage44:browser-e2e
npm.cmd run stage43:mobile-attachments-regression --workspace backend
npm.cmd run stage43:browser-e2e
npm.cmd run stage42:operational-closure-regression --workspace backend
npm.cmd run stage42:browser-e2e
npm.cmd run stage40b:downtime-task-analytics-regression --workspace backend
npm.cmd run stage40a:archive-center-regression --workspace backend
npm.cmd run stage39:system-coherence-regression --workspace backend
npm.cmd run stage30:release-readiness-regression --workspace backend
node --check backend/prisma/seed.js
```

Показать список:

```powershell
npm.cmd run stage45:full-pilot-gate --workspace backend
```

Запустить quick gate:

```powershell
node backend/scripts/stage45-full-pilot-gate.js --run
```

## Production-like safety scan

Проверяется:

- `.env` не коммитится;
- `uploads`, `logs`, `dist`, `node_modules` игнорируются;
- `/health` и `/version` не отдают секреты;
- `storagePath`, `passwordHash`, tokens не уходят в API/archive responses;
- `window.prompt/alert/confirm` не используются;
- видимые русские экраны без mojibake и английских заглушек.

## Что остаётся ручным

- реальный телефон и разные браузеры;
- PWA installability;
- камера и системный file picker на физическом устройстве;
- reconnect/offline ощущения;
- качество касаний на рабочем телефоне в перчатках;
- фактический пилот с реальными ролями, линиями и сменами.
