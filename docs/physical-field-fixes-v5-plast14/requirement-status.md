# Пласт 14: статус требований R1-R10

Дата evidence: 25.08.2026.

## R1 Available compact — PASS

**Before:** карточка доступного periodic checklist занимала 427 px на viewport 390 px, содержала 11 строк и длинное описание следующей проверки.

**Root cause:** основной список одновременно показывал описание, расширенную metadata и служебное состояние доступности.

**Fix:** в «Доступных» оставлены название, одна компактная строка назначения/периодичности и два ясных действия; подробности открываются отдельно.

**After:** измеренная высота marker-карточки 127 px, metadata — одна строка, действий — два; длинное название ограничено двумя строками.

**Regression:** browser E2E, screenshots `01-available-compact-390.png` и `test-artifacts.json`.

## R2 Periodic In Work ownership — PASS

**Before:** после завершения occurrence ownership оставался активным, но тот же шаблон ошибочно продолжал отображаться в «Доступных».

**Root cause:** read-model вычислял due state, но не исключал active/paused ownership; для `MANUAL` активный run проверялся слишком поздно.

**Fix:** backend возвращает в `available` только реально доступные шаблоны, а frontend дополнительно исключает template активного scoped run.

**After:** завершение отдельной проверки оставляет один active `ChecklistRun`, создаёт следующий `ChecklistRunCheck` и не возвращает шаблон в «Доступные».

**Regression:** P14 backend 50/0, periodic lifecycle 56/0, browser E2E.

## R3 In Work counter — PASS

**Before:** дублирование шаблона между списками делало счётчики визуально противоречивыми.

**Root cause:** «Доступные» отражали due metadata, а не возможность взять ownership.

**Fix:** счётчики строятся из непересекающихся scoped collections active runs и genuinely available templates.

**After:** после take счётчик «В работе» увеличивается, «Доступные» уменьшается; после occurrence ownership остаётся один; после cleanup оба marker-счётчика равны нулю.

**Regression:** browser lifecycle assertions и post-cleanup screenshot `08-post-cleanup.png`.

## R4 Duplicate take protection — PASS

**Before:** UI оставлял вторую кнопку take, хотя backend уже умел идемпотентно вернуть существующий run.

**Root cause:** UI/read-model не отражали canonical transaction lock и ownership uniqueness.

**Fix:** active ownership скрывает template из Available; backend lock/idempotency сохранены без ослабления guards.

**After:** два пользовательских контекста сходятся к одному ownership; retry возвращает тот же run; active ownership — 1, duplicate active occurrence — 0.

**Regression:** screenshot `04-duplicate-prevented.png`, P14 backend race/idempotency checks и E2E duplicate journey.

## R5 Compact timer — PASS

**Before:** длинная фраза о следующей проверке занимала несколько строк и смешивалась с действием текущего occurrence.

**Root cause:** срок отображался описательным текстом без единого короткого formatter.

**Fix:** один server-offset-aware formatter выдаёт `MM:SS`, `H:MM:SS`, «Пора» или «Просрочен · …».

**After:** срок помещается в компактную status pill; countdown обновляется каждую секунду без изменения layout.

**Regression:** screenshots `02-in-work-countdown-390.png`, `03-in-work-due.png`; browser timer assertions.

## R6 Deterministic sorting — PASS

**Before:** due state и сортировка вычислялись разными представлениями времени.

**Root cause:** отсутствовал единый приоритет overdue/due/closest/no-due/paused.

**Fix:** active runs сортируются детерминированно по phase, ближайшему сроку, названию и id.

**After:** порядок до completion: overdue A, B через 10 минут, C через 40 минут; после completion: B, C, A с новым интервалом.

**Regression:** `test-artifacts.json.sorting` и browser E2E.

## R7 Local detail/history — PASS

**Before:** подробности и completed occurrences активного periodic run были доступны только через тяжёлый глобальный архивный контур.

**Root cause:** journal endpoint по умолчанию выбирал только закрытые runs.

**Fix:** локальная detail-sheet запрашивает строго scoped `includeActiveOccurrences=true`; глобальный journal сохраняет прежнее closed-only поведение.

**After:** видны последние пять завершённых occurrences, исполнитель, время, ответы, комментарии и фото; новые идут первыми.

**Regression:** backend проверяет occurrence #1/#2 и latest-first; screenshot `07-detail-history.png`.

## R8 Template control compaction — PASS

**Before:** управление шаблонами занимало несколько равнозначных входов на рабочем экране.

**Root cause:** manager actions были смешаны с ежедневным take/run flow.

**Fix:** оставлен один вход «Управление шаблонами»; создание и существующий builder находятся внутри manager view.

**After:** основной экран остаётся scan-first, а create/edit/archive не потеряны и используют существующий builder.

**Regression:** Stage44 27/0, Stage50 22/0, browser post-cleanup health assertion.

## R9 Runner spacing — PASS

**Before:** длинные labels, input, status, optional comment и footer визуально конкурировали на мобильном экране.

**Root cause:** focused runner не имел достаточного вертикального ритма для сложных item states.

**Fix:** canonical styles получили scoped runner spacing, стабильный progress block, читаемые input/status и sticky actions с safe-area.

**After:** numeric input остаётся доступным при клавиатуре, dirty state виден, footer не перекрывает контент; Android Back закрывает текущий слой.

**Regression:** screenshot `05-runner-numeric.png`; 360/390/430 overflow = 0, one-finger scroll, keyboard focus, safe-area и Android Back — PASS.

## R10 Composite item substeps — PASS

**Before:** NUMBER + required photo + comment показывались одновременно в одном перегруженном item.

**Root cause:** несколько требований одного canonical row не имели последовательной UI-подачи.

**Fix:** один backend item представлен двумя UI-шагами: сначала значение, затем фото/комментарий; schema/API не раздваиваются.

**After:** required photo блокирует завершение до файла; optional comment сохраняется; итог записывается в один occurrence row.

**Regression:** screenshot `06-composite-photo-step.png`, P14 backend required/optional photo checks и browser runner journey.

## Итог

- R1-R10: `PASS`.
- P0: 0.
- P1: 0.
- Migration: не нужна.
- Финальная Android-проверка сознательно отложена до завершения Пласта 16.
