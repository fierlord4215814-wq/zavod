# Physical Phone Gate

## Статус

- Автоматический desktop/mobile evidence: **PASS**.
- Удалённый HTTPS/PWA/WebSocket evidence: **PASS**.
- Stage06 PWA/session/navigation/realtime hardening: **PASS**.
- `PHYSICAL_PHONE_GATE: PENDING`.

Статус не повышается автоматически: Playwright и удалённый Quick Tunnel не заменяют проверку реального Android-устройства с установленной PWA.

## Уже доказано

- Viewport 360/390/430 без horizontal overflow на маршрутах этапов 01-04.
- Mobile navigation, safe-area, sticky actions и layered Back в Playwright.
- Factory/department/company isolation и прямые API deny.
- Attachment transport, retry/cancel и отсутствие публичного `storagePath`.
- Microphone permission recovery на эмулированном browser media context.
- Offline/realtime/PWA readiness, актуальные manifest/service worker и session refresh.
- Удалённый public HTTPS runtime, same-origin API, WebSocket и вход всех 18 ролей.
- Chat/error-report round trip и reconnect через публичный origin.
- Stage06: shell cache `zavod-shell-v5`, fallback-only polling, logout/context WebSocket cleanup и защита незаписанного ответа focused checklist runner.

## Проверить на физическом телефоне

1. Установить PWA и запустить её с домашнего экрана.
2. Проверить меню Guest, WORKER, MASTER, STORE и ADMIN.
3. Проверить camera/gallery и повторный выбор одного файла.
4. Проверить microphone deny -> allow -> retry, отправку и playback voice note.
5. Проверить push/vibration при реальном разрешении браузера и ОС.
6. Проверить экранную клавиатуру, sticky footer и safe-area.
7. Проверить аппаратный/gesture Back на всех sheets, dialogs и шагах форм.
8. Проверить pull-to-refresh и отсутствие потери незавершённого draft.
9. Пройти живой MASTER маршрут текущей смены.
10. Открыть будущую смену и личную историю работника.
11. Проверить checklist constructor и focused runner, включая фото.

## Условие PASS

`PHYSICAL_PHONE_GATE: PASS` допустим только после фактического выполнения списка выше пользователем на установленной PWA. До этого статус остаётся `PENDING`, даже при `AUTOMATED_GATE: PASS` и `AUTOMATED_REMOTE_GATE: PASS`.

Текущая инструкция и QR: [mobile-pilot-access.md](mobile-pilot-access/mobile-pilot-access.md).

Текущий Stage06 public runtime: `https://weddings-usd-pix-huge.trycloudflare.com`.
