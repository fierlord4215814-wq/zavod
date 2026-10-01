# LOCAL-01 — безопасный review-пакет, 24.09.2026

Это индекс **фактических** результатов и исходников внутри ZIP, а не замена source files ссылками на защищённый runtime. В пакет не входят секреты, `.env`, SQL dumps, uploads или файлы пользователей. Все пробы работали только с собственными учебными Windows DB/loopback. Исторический dirty worktree не очищался.

## Версия и изменённые владельцы

- Backend `dist/main.js` SHA-256 `db062ade8787028decd1718f8f316010ab438f7f726d716b90b5cb2a610109ce`; frontend asset `index-B2xY9h_j.js` SHA-256 `c4e38a263892ba5552480a94226f1175741a8d49f0cda66dfe341c14891e99d6`.
- `frontend/src/screens/ShiftPeopleScreen.tsx`: явный department context для первого ADMIN и объяснение законного окна handover; `frontend/src/api/client.ts`: узкий `getOptional` для пустого `previous=200`, другие ответы остаются строгими.
- `backend/src/modules/checklists/checklists.service.ts`: post-commit `checklist_updated` для template create/update, чтобы уже открытая страница разрешённого пользователя получила новый шаблон без F5.
- `backend/src/modules/chats/chat-message-delete-policy.ts`: ранее внесённая в LOCAL-01 защита stale/revoked chat/file context включена в пакет как текущий security owner; текущий ход её не переписывал. Direct-chat role defaults/explicit membership остаются отдельным нерешённым policy вопросом.
- Новых migrations, зависимостей, product modules или полномочий ролей в этом ходе нет. Schema SHA-256 `43ceafbf56c34116b3db2fd40ded805d99276f5d68d28b5e7b68f745ef48df2a`.

## Доказательства по уровням

| Область | Доказано | Не засчитывать как |
|---|---|---|
| UI-SWEEP-036 | Обычная запись/комментарий/файл и soft-архив через живые C1 HTTP/UI; 19 bindings поимённо в `c1-036-reconciliation.md`; guarded file SHA, archive rights, `archive=true` и прямой URL; immutable snapshot через Edge/UI/API/SQL на отдельной managed-time копии; поздний restore/readback | Полный gate, естественное окно исходной C1, все guest/revoked/cross-factory live actors, полный server-filter proof, второй UI-сеанс без F5 |
| Handover 409 | ADMIN без отдела 409; с отделом вне окна availability 200/false, summary 409, previous пустой 200; OKK без manage 403; UI после fix показывает действие/объяснение по фактическому времени | Пропавшую запись или разрешение менять backend guard |
| Checklist | Десять разных result-photo файлов/SQL/архивный runner из прежнего C1; 2 шаблона через UI, 3 закрытых простых обхода; новый шаблон виден на второй странице без F5; старый закрытый row text не изменился после UI edit | Фото-эталон template row, десятипунктовое заполнение целиком через UI, upload interruption/retry |
| Финальный Windows C0 | Новая DB без dump, 56 migrations, clean foundation, первый ADMIN/личный пароль, 2 независимых Edge login, API/WS, пустые экраны и SQL business rows 0 | Linux/Compose/VPS/physical phone |
| Поздняя сохранность | 15 файлов byte-identical; testclock immutable snapshot SHA одинаков до/после; custom dump 431349 байт, SHA `CA02D79000A4EC5C761FDF31E5637B46E9C635A82E317453B598B46416C34C6C`, TOC 802, новая restore DB с SQL counts `2/16/4/4/15/510`; реальные Edge handover/archive/file/checklist reads | Compose volume, Linux permissions, Stage68 updater, серверный reboot |
| Будущая смена UI | Две адресные попытки Edge 390 px прошли формы mark/plan WASH/release и ожидание второй страницы без F5; оба harness завершились `exit 1` только на повторной навигации после reload; после каждой отдельный Edge/API readback `/shift/future=200`, `ownAssignment=null`, `will-be/cancel=201` | Полный чистый after-reload UI PASS, доказательство временной границы/scheduler |

## Проверки и технические пределы

- `node --test backend/scripts/ui-sweep-036-archive-contract.test.js backend/scripts/master-r2-handover.test.js`: 14/14 PASS.
- `node --test backend/scripts/master-r2-checklist.test.js`: 7/7 PASS.
- `npm --prefix backend run build`, `npm --prefix frontend run typecheck`, `npm --prefix frontend run build`: PASS. Последняя frontend build: 88 modules; предупреждения Vite CJS API и размера chunk не являются скрытым тестовым отказом.
- Prisma `validate` на отдельном own migration staging: PASS; последняя fresh DB получила все 56 migrations. `prisma generate` в этом ходе не повторяли, так как schema неизменна и прежняя проверка сохранена.
- `stage13-checklists-regression.js` запущен без `DATABASE_URL` и завершился до действий с БД; **не PASS**, не перенаправлялся на живую C1 из-за data-mutating исторического сценария.
- `node --check` всех новых C1 scripts и targeted `git diff --check`: PASS. Targeted scan не нашёл browser prompt/alert/confirm и mojibake в затронутых source owners; `storagePath/passwordHash` встретились только в защитном регулярном выражении `api/client.ts`, не в пользовательском payload.

## Точный остаток до полного функционального PASS

1. Пять named live gates остаются **частичными**: для 036 перечисленные выше негативные и втоространичные ветви; MI-SEC concurrency/lock/fanout; MI-PUB audience/publication policy; MI-R2-ORD cross-factory/restore/full UI; MI-R2-CHAT-ATT group/stream/retry/restore и решение role policy.
2. Не выполнена вся оставшаяся UI-программа по ролям/сменам/назначениям/заявкам/остаткам/мойке/оттайке/качеству; ранние HTTP/WS/SQL и некоторые формы перечислены в `report.md` и не повышены до полного UI PASS. Будущее WASH-назначение получило адресное `PARTIAL_UI` без F5, но не чистый after-reload harness PASS. «Я буду» обновляет MASTER за ~6–8 секунд polling, не WS.
3. Фото-эталон шаблона не реализован: нужен отдельный schema/attachment/access/immutable archive policy decision. Нельзя закрыть его десятью фото результатов.
4. Chat policy: WORKER default `chats.read/write`, CONTRACTOR без chat defaults/overrides, direct-chat route создаёт explicit membership без них. Точное разрешение для WORKER/CONTRACTOR не утверждено; guards/defaults не меняли по догадке.
5. Linux/Compose, volumes, HTTPS/WSS, physical phone, UI-SWEEP-063 original, UI-014/050 provenance и replay/publication decisions не приняты. Полноценный новый завод, реальный №4 и VPS не создавались.

`MAIN_UI_SWEEP=PAUSED_BY_USER / NOT_ACCEPTED`; `MASTER_R5_EXECUTION=PAUSED_BY_PRIORITY_CHANGE`; `LINUX_DEPLOYMENT=NOT_VERIFIED_DEFERRED`; `LOCAL01_STATUS=C1_WINDOWS_FUNCTIONAL_PARTIAL`.
