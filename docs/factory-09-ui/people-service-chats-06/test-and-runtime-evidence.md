# FACTORY9-06 — проверки и граница runtime

## Продолжение 30.09.2026 — актуальный результат

| Проверка | Факт |
|---|---|
| Source sync | 13/13 `source-after` файлов внешнего пакета совпали по SHA с текущим кодом до правки. |
| Production launch | `Start-Process` существующего `backend/dist/main.js` с проверенными DB/port/storage/JWT и `CORS_ALLOWED_ORIGINS=http://127.0.0.1:5173` отклонён инструментом до исполнения: `CreateProcess ... rejected: blocked by policy`. Не повторялся через иной канал. |
| Backend build / frontend typecheck + build / Prisma validate | `exit 0` / `exit 0` + `exit 0` / `exit 0`. Первоначальный typecheck до точной правки AdminConfigScreen был `exit 1` (TS2448/TS2454), после правки `exit 0`. |
| Targeted tests | F04+F05+F06: 19 tests, 19 PASS, 0 FAIL. Includes exact-member/role/dept, local realtime policy, wrong-context/revoked WS event denial, 1/2/3 shared group creation and TECH self source guard. Эти tests — isolated, не live HTTP/WS. |
| Disposable SQL | На своём `127.0.0.1:15445` создана одноразовая БД, 57 migrations, fault rollback и sendHome/self-end race с LINE Assignment/одним credit/одним experience PASS; БД удалена, кластер остановлен, 15445 закрыт. Источник `mes` не использован для fault. |
| Fresh `mes` read-only | 57 migrations, shared chats0, №9 chats0, UFA №4 2486/№9 26, профиль Андрея 8 ALLOW, три старые TECH UFA №9 active. |
| Runtime final | 3000/5173/15445 отсутствуют; PostgreSQL 5432 PID5316. `/ready`, `/version`, обычный вход, browser, actual WS в продолжении `NOT_RUN`. |

Protected current DB dump `mes.before-resume-06.dump` в исходном защищённом backup directory: 13 720 252 байта, SHA-256 `5A2F1C6FF5B6A6F375C8FF3B98EDC4739365BB7003B5136464D49B20F8BDCBD3`, TOC806. Все 2269 uploads и оба protected config files сверены с сохранённой парой по SHA; содержимое и секреты не выведены. SQL test вывел только безопасные статусы, raw логи cluster и dump не включать в review.

Ни один shared chat, сообщение, UI role mutation, новая Task, checklist, рабочая ShiftSession/Assignment или Attachment не создан в `mes` на этом продолжении. Нижняя таблица — первый исторический source-срез до продолжения, не текущие итоговые числа.

| Проверка | Команда / факт | Результат |
|---|---|---|
| Backend TypeScript | `npm --prefix backend run build` | `exit 0` |
| Frontend Vite | `npm --prefix frontend run build` | `exit 0`, 89 modules; warning chunk >500 kB |
| Prisma schema | `npm --prefix backend run prisma:validate` | `exit 0`, schema valid; этот запуск загрузил локальный `.env`, но его содержимое не выводилось и не изменялось |
| Совместные isolated regressions | `node --test backend/scripts/factory09-functional-closure04.test.cjs backend/scripts/factory09-shift-multifactory05.test.cjs backend/scripts/factory09-people-service-chats06.test.cjs` | 17 tests, 17 PASS, 0 FAIL, `exit 0` |
| Fresh process identity | `Get-NetTCPConnection -State Listen -LocalPort 3000,5173,5432` | 3000 отсутствует; 5173 PID3652; 5432 PID6052 |
| `mes` read-only до/после | DB/factory/UFA/chat/migrations fingerprints; никаких рабочих секретов в документе | №4 UFA2486, №9 UFA26, shared chats0, 57 migrations; старый №4 chat остался локальным |
| Backend restart | Первый запуск PID18116 вышел с `[STARTUP_FAILED]` из-за отсутствующего production `CORS_ALLOWED_ORIGINS`; исправленный запуск отклонён политикой `exec_command` до исполнения | `BLOCKED_POLICY`; обхода через альтернативный канал не было |
| Browser/API/WS/SQL на новом build | Требуют работающего backend | `NOT_RUN`, не PASS |
| Disposable SQL race/fault | Предыдущий SQL script на рабочем сервере требует отсутствующее `CREATE DATABASE`; отдельный собственный cluster в этом блоке не создан | `NOT_RUN`; на `mes` fault injection не применялся |

Проверка 06 не сделала новых UFA, чатов, Task, ChecklistRun, ShiftSession, Assignment или Attachment. Три прежних №9 UFA и локальный профиль Андрея не отзывались. Старые №4 файлы и история не менялись. Независимый restore предзаписи не выполнялся.
