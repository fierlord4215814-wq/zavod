# FACTORY9-FUNCTIONAL-CLOSURE-04 — проверяемые результаты

Дата среза: 29.09.2026, локальная `mes` на `127.0.0.1:5432`. Этот документ не содержит конфигурацию, пароли, токены или содержимое файлов вложений.

## Сборки и isolated

| Команда | Exit | Итог |
|---|---:|---|
| `backend: npm run build` | 0 | `tsc -p tsconfig.build.json` |
| `frontend: npm run build` | 0 | Vite 5.4.21, 89 modules transformed; есть только предупреждения CJS API и размера bundle |
| `backend: node scripts/factory09-functional-closure04.test.cjs` | 0 | 6 tests / 6 pass / 0 fail: локальный профиль, отказ self/ADMIN/peer, запрет other UFA/global, contractor title, одна shared TECH presence |
| `backend: node scripts/factory09-company-scope.test.cjs` | 0 | 2 tests / 2 pass / 0 fail |
| `backend: node scripts/checklist-verify-01.test.cjs` | 0 | 5 tests / 5 pass / 0 fail; rolling due от factual completion и exact checkId/photo сохранены |

## Runtime/read-only SQL

- Listener `127.0.0.1:3000`: Node PID `11788`, `dist/main.js`; `GET /ready` → `ready:true`, `GET /version` → `MES4-FACTORY9-FUNCTIONAL04-20260929-B`. Listener `127.0.0.1:5173`: Node PID `20532`, Vite preview. Дальнейшее использование требует fresh PID/DB readback.
- `mes`: №4 `537cbb48-7fba-48b6-80af-659f82cdaeb3`, №9 `f33f9682-8168-4562-a8c8-5c196b2c0d37`; 57 успешных migrations, 2486 UFA №4, 23 UFA №9, один active guest №9.
- Task `f9a4e9d6-2e3f-4cd8-a83d-f414481af28c`: `factoryId=№9`, `LONG`, `DONE`, author `4068896f-ec64-51e1-a0b3-db9260f89713` (Борис), assigned/taken/done `26e14ab0-7b07-585d-a29f-563d84caaac5` (Зоя), `TaskComment=2`; создана `2026-09-28 21:57:04.450 UTC`, завершена `21:57:42.062 UTC`. Это одна запись Task, не копия для другого завода. Для неё есть долговечные Notification rows; UI у Зои показал badge/карточку, у Бориса — закрытие.
- Contractor Assignment `0960369c-64c0-4ce8-bbb1-86f6c0e719c3`: после штатной остановки линии `endedAt=2026-09-28 21:48:53.985 UTC`. Contractor ShiftSession `e4ad2b06-3a7c-42cf-b1af-1a4bb0e7bcb5` после «Отправить домой» всё ещё `ACTIVE/endedAt=NULL` — defect, не PASS закрытия смены.
- Защищённый backup до записи: 13 698 010-byte custom dump, SHA-256 `5772E202D2CEC4A8E96CCE613FEC7753472029CB790827AC3AD4DC1757FC2598`, TOC 806. Финальное сравнение SHA-256 всех 2268 файлов в protected-before uploads с `work/uploads`: missing 0, changed 0, added 0. Independent restore не выполнялся.

## Browser / no-F5

Два реально независимых origin/session: `127.0.0.1:5173` — мастер Борис, `localhost:5173` — специалист Зоя. При создании LONG-заявки на странице Зои без reload/F5 появились toast «Новая заявка», badge `1`, точная карточка; после `take/comment/done` уже открытая страница Бориса без F5 показала `DONE`, имя Зои и два комментария. Снимки `two-window-task-new-zoya.png`, `two-window-task-done-boris.png`. UI показывал «Обновлено: появились изменения в заявках», но отдельный raw WebSocket frame не сохранён; это доказательство пользовательского live-обновления, не протокольный packet trace.

Чек-лист после обычного повторного входа и рестарта backend показал `Завершено проверок: 3` отдельно от `Последняя проверка не завершена: 0 из 2 пунктов`; общий архив A/B/C доступен. Снимок `checklist-summary.png`.

## Границы доказательства

Не проверены live: grant/revoke/restore №9 трём прежним TECH №4; локальный профиль Андрея после UI-гранта и отрицательные runtime пробы; shared-service Task/chat/shift с переключением №4↔№9; опубликованный return с обязательным фото; physical push/телефон/HTTPS/WSS/VPS. Source/isolated не выдаются за эти результаты.
