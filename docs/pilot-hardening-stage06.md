# Stage06 — предпилотная стабилизация

Дата проверки: 23.07.2026.

## Итог

- `STAGE06: PASS_WITH_P2`.
- P0: 0.
- P1: 0.
- Известные P2: `F25`, `J29`, `J31`.
- `PHYSICAL_PHONE_GATE: PENDING`.

Stage06 не добавляет продуктовых функций и не пересматривает закрытые Stage00–Stage05. Выполнена точечная стабилизация существующих PWA, session/navigation, realtime и mobile runtime контуров.

## Current state audit

- Backend production build: PASS.
- Frontend production build: PASS; остаётся известное неблокирующее предупреждение Vite о размере основного chunk.
- Prisma validate: PASS.
- Prisma migrate status: PASS, 45 migrations, схема актуальна.
- Новых миграций нет.
- Worktree содержит большой объём ранее согласованных изменений Stage00–Stage05; откатов и очистки не выполнялось.
- Старый Quick Tunnel и его четыре процесса были подтверждены по PID и командной строке перед остановкой.

## Выполненные изменения

### PWA freshness

- Canonical service worker сохранён единственным.
- Версия shell cache повышена с `zavod-shell-v4` до `zavod-shell-v5`.
- Навигация использует network-first, static assets — cache-first, API и пользовательские данные — network-only.
- Проверены install/update/offline shell и отсутствие reload loop.
- Публичный service worker фактически отдаёт `zavod-shell-v5`.

### Session/navigation

- Canonical role-home, session-scoped route и очистка маршрута при logout/смене пользователя подтверждены regression и browser E2E.
- Layered Back закрывает верхний modal/sheet/keyboard раньше маршрута.
- Focused checklist runner подключён к существующим `useMobileBackLayer` и `useMobileFormDirty`.
- Незаписанный ответ или ожидающий файл больше нельзя потерять молча: используется существующий `AppConfirmDialog`.

### Network/realtime

- Второй WebSocket-клиент не создавался.
- Существующий reconnect ограничен и очищается при logout/смене context.
- Счётчики запрашиваются один раз при старте.
- Периодический polling включается только при realtime fallback и останавливается после восстановления WebSocket.
- External smoke подтвердил same-origin API, WebSocket, session switch, chat round trip и reconnect без дублирования runtime.

### Runtime lifecycle

При первом restart выявлен узкий PowerShell-дефект: старый runtime manifest не содержал свойства `stoppedAt`, из-за чего stop-скрипт завершался после корректной остановки PID, но до записи статуса. В `stop-quick-tunnel-pilot.ps1` добавлено безопасное `Add-Member -Force`. Повторный restart прошёл и создал новый runtime.

## Targeted mobile smoke

- Guest: role-home, заявка назначения, отдельное сообщение об ошибке, dirty draft и Back.
- WORKER: canonical смена, будущая смена/история и read-only ограничения.
- MASTER: компактный command center, assignment sheets, future planning, Back.
- Checklists: четыре раздела, canonical constructor, create/edit/duplicate, focused runner, Back/Next state и защита несохранённого ответа.
- Viewports: desktop, 360, 390 и 430 px.
- Horizontal overflow по targeted browser suites не обнаружен.

## Новый mobile runtime

- Public HTTPS: `https://weddings-usd-pix-huge.trycloudflare.com`.
- Local backend: `http://127.0.0.1:3000`.
- Local frontend gateway: `http://127.0.0.1:5173`.
- Backend PID: `4324`.
- Frontend PID: `10652`.
- Tunnel PID: `6264`.
- Keep-awake PID: `8604`.
- Runtime evidence: `docs/quick-tunnel-mobile-pilot-v1/runtime/20260723-204408Z`.
- QR: `docs/mobile-pilot-access/mobile-pilot-qr.png`.

Проверены внешний HTTPS, `/api/health`, manifest, service worker, свежий bundle, 18 pilot-ролей, factory context, session switch, WebSocket, PWA secure context, chat и error report. Публичный bundle не содержит dev URL `localhost:3000` или `127.0.0.1:3000`.

## Данные и безопасность

- Reset/drop/truncate/delete не выполнялись.
- `.env`, uploads и backups не менялись.
- Реальные смены, мойки, заявки и история не закрывались.
- Backend guards, factory/department/company isolation и security assertions не ослаблялись.
- Prompt/alert/confirm browser API не добавлялись.
- `storagePath`, `passwordHash`, credentials, token и secret values в изменённых файлах/отчётах не обнаружены.

## Остаток

- `F25`: отдельный комментарий к строке плана линии требует отдельного schema/UX решения.
- `J29`: demand workflow внешней фирмы не входит в Stage06.
- `J31`: cross-factory invitation/request не входит в Stage06.
- Камера, реальный microphone deny/allow, push/vibration, safe-area, аппаратный Back и живая MASTER-смена требуют физического Android с установленной PWA.

Эти пункты не повышены до PASS автоматически.
