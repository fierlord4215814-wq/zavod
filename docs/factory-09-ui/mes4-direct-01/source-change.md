# MES4-FACTORY9-DIRECT-01 — адресный source change

Снимок `before` для трёх продуктовых файлов находится в защищённой pre-migration копии `C:\Users\79164\AppData\Local\Zavod-MES4\backup-20260928-direct01\code-release`; тестовый файл `before` взят из неизменённого `autonomous-01` review ZIP. Оригинальные файлы/ZIP не перезаписывались. В текущем репозитории эти исходники не отслеживаются Git, поэтому обычный `git diff` по ним пуст; review ZIP хранит точные `before/after` и unified diff.

| Владелец | Изменение | Проверка |
|---|---|---|
| `backend/src/modules/admin/admin.service.ts` | Узкое ADMIN-only атомарное назначение/отзыв четырёх заводских overrides для активного TECHNOLOG; проверка factory/UFA/каталога/причины; аудит и auth invalidation после commit | backend build, isolated negative/positive test |
| `backend/src/modules/admin/admin.controller.ts` | Защищённый endpoint существующей админки для указанного действия | guard + service isolated test |
| `frontend/src/screens/AdminConfigScreen.tsx` | Кнопка в профиле только при роли TECHNOLOG на выбранном заводе, подтверждение и причина; роль/глобальная матрица не меняются | frontend build; живой профиль №9 ещё отсутствует, UI action NOT_RUN |
| `backend/scripts/factory09-authority.test.cjs` | Отказ MANAGEMENT, чужому заводу, иной роли, отсутствующей причине и неполному каталогу; 4 ALLOW→4 DENY без смены UFA/роли | 4/4 в файле, 13/13 связанный набор |

В исходной `mes` read-only найдено ровно четыре ожидаемых Permission.code. Source-fix не выдавал прав никому в `mes`; `UserPermissionOverride` бизнес-записей через API/SQL не создавалось. `MANAGEMENT` заводское делегирование не ослабляли: существующие ADMIN-only guards требуют отдельного безопасного контрактного изменения и live negative checks после появления учебной учётки.

SHA-256 source `before→after`:

- `admin.service.ts`: `B0AC5F74200267E5CF942AF9AB05E1CF275A6AF0E92FDB67B36E684C3CEDDC67` → `4F6DB066FF2C83595CBC0457F21305844DAC85199E756196CBAA2271FC946C30`
- `admin.controller.ts`: `51B7A0A25E2457C4AA377EF56CD8E9BED47F00667C93F382BECEBEB0B7B5B670` → `5904761887B507994C033F27A3CC50BC4CFF3E9FCCA045785D6F58E14CB078D9`
- `AdminConfigScreen.tsx`: `2A2735FC688CEB90AE62F1626DABB5F16A0E169EFA185C417AECF1D3B39803F3` → `5A5F868292FF7E510021BCA05A9F8FC55B23BF861C372A40BB97FEEB1C50A8BD`

Последовательность: backend build сначала обнаружил TS18048 на optional reason; исправлено до запуска. Затем backend build exit0, `node --test` 13/13 exit0, frontend build exit0. Штатный backend restart сначала был отвергнут preflight `DB_UNAVAILABLE` из-за внешних кавычек в защищённом env-файле; исправлен только способ чтения runtime env, без правки файла или БД; следующий start `/ready=true`. Это не live PASS совмещения: его выполнить можно только после штатной регистрации/назначения одного профиля TECHNOLOG.
