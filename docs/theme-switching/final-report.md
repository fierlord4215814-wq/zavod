# ZAVOD V1.0 — Three Themes Goal — final report

Дата: 13.09.2026. Основной UI Sweep на всём протяжении оставался на паузе.

## Итог

Отдельная задача трёх тем завершена в согласованном browser/frontend scope. Существующая тёмная Industrial Premium 10F сохранена как default. Добавлены полнофункциональные `Серая` и `Светлая` темы, единый локальный selector в Settings, раннее применение до React и безопасный fallback. Новых открытых theme-регрессий после change-impact retests нет.

Physical Android и installed-PWA chrome не проверялись на физическом устройстве и остаются `PENDING`; это не выдано за browser PASS. Backend/DB correctness не входит в тему оформления и не эмулируется как live evidence.

## Реализация и владельцы

| Требование | Изменённый owner | Результат |
| --- | --- | --- |
| Один root theme contract | `frontend/src/theme.ts` | тип `dark|gray|light`, meta map, guarded read/apply/persist, unknown/missing → Dark |
| Без flash | `frontend/index.html` | theme bootstrap выполняется до `/src/main.tsx`; default `data-theme="dark"` остаётся safe baseline |
| Один selector в существующих Settings | `frontend/src/App.tsx` | блок «Оформление», exact buttons `Тёмная / Серая / Светлая`, `aria-pressed`, галочка, текст `Выбрана: …` |
| Полные palettes | `frontend/src/styles.css` | Gray/Light variables и scoped cascade для shared/UI-owner surfaces; dark defaults не переписаны |
| Targeted regression/evidence | `frontend/e2e/three-themes.spec.ts` | последовательный one-worker intercepted browser harness; unrelated writes abort |

`frontend/src/main.tsx` не изменён этой задачей и byte-identical сохранённому task baseline. Второй provider/store/design system, API preference, schema field и migration не создавались.

## Поведение выбора

Target `Theme behavior is immediate, local and independent from app lifecycle` доказал:

- Gray и Light применяются сразу к `html[data-theme]`, без remount `.app-shell`;
- selected state доступен не только цветом: exact label, `aria-pressed=true`, галочка и русский status;
- клик не создаёт API read/write и не меняет число product `/ws` sockets;
- Light появляется уже на первом animation frame после reload;
- выбор сохраняется через reload, logout/login-подобный reload и Settings → выбор завода → возврат;
- тема не привязана к пользователю/заводу и остаётся device-local для текущего origin;
- исключение `localStorage.setItem` не ломает смену: Gray применяется, UI показывает русский notice;
- отсутствующее и неизвестное значение безопасно дают Dark;
- runtime: `apiWrites=[]`, `isolatedFixtureWrites=[]`, `pageErrors=[]`, `consoleErrors=[]`, `requestFailures=[]`.

Evidence: `screenshots/20260913-150000-behavior-final/runtime.json` и `verification.md`.

## Сохранность Dark baseline

До product edits снят immutable batch 16 PNG: Settings, реальная форма отчёта, shared gallery и modal × 1440/360/390/430. После реализации те же четыре состояния сняты во всех трёх темах.

Результат проверки Dark:

- canonical dark variables/rules не заменены; все palette overrides для новых тем имеют scope `data-theme="gray"|"light"`;
- новых `!important` в task diff `styles.css` нет;
- все before/after originals непосредственно просмотрены, геометрический overflow в обеих сериях равен нулю;
- mobile overlay на 360/390/430 pixel-identical до/после;
- Settings ожидаемо отличается добавленным selector;
- Report after выше из-за явно видимого PWA fallback banner из runtime-state, а не из-за темы;
- остальные hash differences при одинаковой геометрии не дали видимой смены palette/иерархии/контраста; exact hashes и размеры сохранены в `dark-comparison.csv`;
- финальный shell batch дополнительно показывает Dark после всех поздних scoped Admin/Auth исправлений.

Итог: `DARK_BASELINE_PRESERVED=PASS` в пределах browser visual/static evidence; physical device остаётся отдельным gate.

## Точная визуальная матрица

Сценарий считается один раз; screenshots, клики и тесты не суммируются как controls.

| Семейство | Уникальные сценарии | Комбинации темы/ширины | Authoritative evidence |
| --- | ---: | ---: | --- |
| 20 non-guest top-level screens | 20/20 | 80/80 = Gray/Light × 1440/390 | `20260913-151000-top-level-final` |
| 14 Admin subsections | 14/14 | 56/56 = Gray/Light × 1440/390 | `20260913-154000-admin-final` |
| 11 Archive categories | 11/11 | 44/44 = Gray/Light × 1440/390 | Archive subset of `20260913-153000-unique-subviews-final` |
| 5 Ops tabs | 5/5 | 20/20 = Gray/Light × 1440/390 | Ops subset of `20260913-153000-unique-subviews-final` |
| 4 shared sensitive states | 4/4 | 48/48 = 3 themes × 1440/360/390/430 | `20260913-140000-core-after-final` |
| 6 shell states | 6/6 | 72/72 = 3 themes × 1440/360/390/430 | `20260913-155000-shell-states-final` |
| **Итого сохранённых after-captures до дедупликации** | **60 заявленных family entries** | **320/320 captures** | indexes below |
| **Дедуплицированный итог** | **58/58 distinct states** | **312/312 distinct theme-width combinations** | Admin/Обзор и Ops/Потери считаются по одному разу |

Отдельно сохранены 16/16 Dark-before captures. Полная строковая карта — `theme-coverage.csv`; каждый PNG и SHA-256 — в `index.csv` соответствующего batch. 56 Admin PNG в `20260913-153000-unique-subviews-final` являются pre-final discovery evidence и не входят повторно в 320 принятых captures: их заменяет `20260913-154000-admin-final`. Внутри этих 320 сохранённых captures top-level Admin совпадает по state с Admin/Обзор, а top-level Ops — с Ops/Потери; восемь соответствующих theme-width captures исключены из distinct total 312.

Роли/identity: Admin для app surfaces, Anonymous для login/register, isolated forced-password fixture, factory-picker identity и Guest. Widths: shared/shell — 1440/360/390/430; все top-level/unique new-theme screens — 1440/390. Во всех 320 принятых captures `overflowX=0`.

## Что было найдено и исправлено внутри этой задачи

1. Первая Gray palette визуально была слишком близка к Dark. Root cause — слишком тёмные gray tokens. Owner `styles.css` переведён на cold gray-blue page и light-gray cards; подтверждение — финальные core/top-level/Admin/Archive/Ops/shell packs.
2. Situation semantic zones и Chats сохраняли hardcoded dark islands. Root cause — поздние owner-specific literals с большей каскадной силой. Добавлены scoped light-scheme rules только для line-state и messenger owners; подтверждение — native Situation/Chats originals в top-level final.
3. Admin setup/permissions/import-export panels и bare labels сохраняли dark/luminous literals. Root cause — nested owners не являлись generic cards. Добавлены точечные Admin rules; 14-section retest заменил обнаруживший дефект batch.
4. Ops inactive tabs оставались dark. Root cause — `.tab-button` отсутствовал в shared theme control mapping. Scoped rule подтверждён пятью Ops tabs в обоих viewport.
5. Auth onboarding intro оставался dark в Gray/Light. Root cause — отдельный `.onboarding-status-card` owner. Scoped Auth/Guest rules подтверждены повторным 72-frame shell batch.

Product/business logic, RBAC, realtime flow, data contracts и paused UI Sweep findings при этих исправлениях не менялись.

## Проверки и evidence class

- Frontend production build: PASS, 79 modules; output `index-DiCeGZdg.css` / `index-qNwt-jG0.js`. Известное предупреждение: JS chunk > 500 kB.
- Targeted Playwright: все final tests PASS, один worker, только локальный frontend.
- Final runtime logs: product `apiWrites=[]`, `pageErrors=[]`, `requestFailures=[]`, `consoleErrors=[]`.
- Shell forced-password coverage выполняет 12 intercepted `POST /auth/login`, записанных отдельно в `isolatedFixtureWrites`; запросы не достигают backend/DB и не являются business writes.
- Visual evidence: originals и contact sheets просмотрены фактически; автоматический zero-overflow не использован как единственное доказательство.
- Live backend/API/DB evidence: **не выполнялось и не заявляется**. Все данные UI — browser-isolated fixtures.
- Physical phone: **PENDING**.

## Evidence packs

| Pack | PNG | Назначение |
| --- | ---: | --- |
| `evidence-zips/20260913-120000-dark-before.zip` | 16 | immutable Dark baseline |
| `evidence-zips/20260913-140000-core-after-final.zip` | 48 | shared sensitive states |
| `evidence-zips/20260913-151000-top-level-final.zip` | 80 | every top-level screen, Gray/Light |
| `evidence-zips/20260913-153000-archive-ops-final.zip` | 64 | authoritative Archive/Ops subset |
| `evidence-zips/20260913-154000-admin-final.zip` | 56 | authoritative Admin retest |
| `evidence-zips/20260913-155000-shell-states-final.zip` | 72 | auth/factory/guest/loading |
| `evidence-zips/20260913-150000-behavior-final.zip` | 0 | behavior runtime/assertion summary |
| `evidence-zips/20260913-theme-goal-report.zip` | 0 | compact handoff: reports, maps, manifests and changed-file list |

Все ZIP открыты после создания; archived PNG hashes совпали с соответствующими manifests (`hashMismatches=0`). Bytes/SHA-256/entry counts сохранены в `zip-manifest.csv`. Contact sheets остаются рядом с originals в `review-contact-sheets/`; screenshot directories и все pre-fix/failure batches не удалены и не перезаписаны.

## Сохранность scope

- Reset/clean/stash/restore/checkout/rebase/commit не выполнялись.
- Dirty worktree и накопленные чужие/предыдущие изменения сохранены; Git status не используется как авторство этой задачи.
- PostgreSQL, backend, Prisma, migrations, seed, DB cleanup, `.env`, uploads, Cloudflare и внешний доступ не запускались/не менялись.
- Использованный локальный Vite проекта (PID 53080, 127.0.0.1:5173) остановлен после финального browser блока; другие Node и PostgreSQL не останавливались.
- Main UI Sweep не возобновлялся: 036/063/047/060/069, coverage 954/957 и его P-levels не переоценивались. Theme evidence не прибавляется к числу sweep controls.

## Остаток

Единственный остаток именно theme goal — physical Android / installed-PWA visual check (`PENDING`). Новых browser theme findings нет. Будущее физическое задание должно проверить только Dark/Gray/Light switch, persistence после installed-PWA restart, status/navigation/sheets/native pickers на реальном 360–430 px устройстве; оно не должно запускать полный UI Sweep.

## Machine-readable final status

```text
THEME_GOAL_STATUS=PASS
DARK_BASELINE_PRESERVED=PASS_BROWSER_STATIC / PHYSICAL_PENDING
GRAY_THEME=PASS_BROWSER_58_DISTINCT_SURFACE_STATE_MATRIX
LIGHT_THEME=PASS_BROWSER_58_DISTINCT_SURFACE_STATE_MATRIX
SWITCH_AND_PERSISTENCE=PASS
THEME_VISUAL_COVERAGE=58/58_DISTINCT_STATES;312/312_DISTINCT_THEME_WIDTH_COMBINATIONS;320_ACCEPTED_CAPTURES
NEW_THEME_REGRESSIONS_OPEN=0
MAIN_UI_SWEEP=PAUSED_BY_USER / NOT_ACCEPTED
PHYSICAL_THEME_CHECK=PENDING
PRODUCT_FILES_CHANGED=frontend/index.html;frontend/src/App.tsx;frontend/src/styles.css;frontend/src/theme.ts
DB_SCHEMA_ENV_UPLOADS_CHANGED_BY_THIS_GOAL=NO
REPORT_PATH=docs/theme-switching/final-report.md
SCREENSHOT_PACKS=docs/theme-switching/evidence-zips/20260913-120000-dark-before.zip;docs/theme-switching/evidence-zips/20260913-140000-core-after-final.zip;docs/theme-switching/evidence-zips/20260913-151000-top-level-final.zip;docs/theme-switching/evidence-zips/20260913-153000-archive-ops-final.zip;docs/theme-switching/evidence-zips/20260913-154000-admin-final.zip;docs/theme-switching/evidence-zips/20260913-155000-shell-states-final.zip;docs/theme-switching/evidence-zips/20260913-150000-behavior-final.zip
REPORT_BUNDLE=docs/theme-switching/evidence-zips/20260913-theme-goal-report.zip
FINAL_STOP=STOP
```
