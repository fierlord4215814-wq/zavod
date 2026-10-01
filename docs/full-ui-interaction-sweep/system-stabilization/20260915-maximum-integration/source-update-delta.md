# Current source update — 15.09.2026

Repository source/current-state слой обновлён ссылками в существующих `progress.md` и `visual-gap-register.md`. Это supersession описаний source, а не перезапуск основного sweep и не закрытие его live findings. Старые reports, matrices, PNG и ZIP сохранены.

`MAIN_UI_SWEEP=PAUSED_BY_USER / NOT_ACCEPTED`; `MAIN_FULL_SWEEP_RESUMED=NO`.

Текущий результат отдельного master: `PARTIAL_WITH_EXPLICIT_BLOCKERS`.11/11 старых roots рассмотрены;9 получили собственные source-изменения,036 перепроверен без переписывания прежнего исправления,014 оставлен перед рискованным provenance/occupancy решением. THV06 проверен по change-impact, без новой реализации меню. Полное описание — `root-result-matrix.md`; реальные недостатки — `decision-queue.md`.

Source truth:044/047/060/063/069 нельзя далее описывать как «не реализованы»: текущие изменения имеют финальное bounded isolated доказательство.042/046/050/053 имеют точечные source predicates и actual-service corpus. Но ни один из этих результатов не означает full live/physical CLOSED.063 функционально не зависит от036; прежний порядок был пользовательским ограничением старого продолжения, superseded отдельным master scope.

Новые подтверждённые старые frontend-дефекты исправлены: MI-FORM-02 checklist rejection, MI-CAP-01 task readonly footer, MI-RT-01 stale WS lifetime, MI-VIS-02 task label. Собственный MI-VIS-01 новый DeviceAccess contrast устранён до финального прохода. MI-SEC-01 и MI-PUB-01 — два неизменённых backend P1 negative contracts, правки остановлены.050 legacy PILOT ambiguity входит в старый050, не новый дубликат.014 требует точной существующей fixture relation и решения по occupancy.

Final product fingerprint: `0b2bd805f1eb468accfe99e9d9c58bc21d2fdbfe0c57c1763b20af6a618b8de4` (207 product source/public/schema files).16 собственных product owners; полный список/хеши и before/after — `source-delta-manifest.json`.17 test/support owners включены отдельно, их нельзя прибавлять к product count. У четырёх новых test files не было начального ABSENT snapshot; доступные промежуточные версии/полные current bytes сохранены, пробел не скрыт. Поздняя единственная harness правка имеет отдельный diff/snapshot и не меняет product fingerprint.

Parent census остаётся историческим:284 surfaces,957rows/956legacyIDs,954PASS/3FAIL; Back1614PASS/4FAIL/4component/1physical; text2711PASS/35FAIL/8NOT_RUN.957 semantic keys сохранены без потерь. Шесть исходных matrices совпали с receipt hashes. Ни один новый runtime/browser/test/screenshot counter не добавлен к954.

Слои хранения:

- Repository: `UPDATED_LOCAL_DIRTY_WORKTREE`, существующие owners и компактный supersession.
- Local artifacts: `SAVED`, отчёты, matrices, logs,329 PNG, source snapshots/diffs; `INDEX.md` содержит части review package и hashes.
- Library/account memory: `PERSISTENCE_PENDING`. Доступного успешного Library write нет; этот файл — готовый delta, не заявление об обновлении памяти аккаунта. Старые Library/source copies поверх текущих не загружались.

Будущему исполнителю: сначала read-before-write текущих owners и `decision-queue.md`; не накатывать весь diff на другой dirty worktree. Для возобновления нужны отдельные узкие полномочия. Текущий preview остановлен, службы не запускать автоматически.
