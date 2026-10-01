# Удалённый мобильный пилот v1.0

## Текущий контур

- Внешний адрес публикуется через Cloudflare Quick Tunnel.
- Quick Tunnel направлен только на локальный gateway `http://127.0.0.1:5173`.
- Gateway отдаёт frontend и проксирует `/api`, `/health` и `/ws` на backend `http://127.0.0.1:3000`.
- Backend, frontend и gateway слушают только localhost. Порты роутера и Windows Firewall не менялись.
- AmneziaVPN остаётся включённым и не перенастраивается. Tailscale не используется.
- Для ручной проверки используется отдельный factory scope `Завод — мобильный пилот`.

Актуальный случайный HTTPS URL хранится в `mobile-pilot-url.txt`, QR-код — в `mobile-pilot-qr.png`. После каждого restart Quick Tunnel адрес и QR меняются.

## Управление runtime

Из корня проекта:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\mobile-pilot\start-quick-tunnel-pilot.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\mobile-pilot\status-quick-tunnel-pilot.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\mobile-pilot\restart-quick-tunnel-pilot.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\mobile-pilot\stop-quick-tunnel-pilot.ps1
```

`stop` завершает только PID, записанные текущим pilot runtime. Он не останавливает другие Node-процессы, AmneziaVPN или Tailscale и не удаляет pilot-данные.

## Учётные записи

| Телефон | Роль |
|---|---|
| +79000009000 | Гость |
| +79000004701 | Работник |
| +79000004711 | Подрядчик |
| +79000004720 | Мастер |
| +79000009004 | Старший мастер |
| +79000004750 | КИПиА |
| +79000009005 | Начальник КИПиА |
| +79000004730 | ОКК |
| +79000004740 | Склад |
| +79000009008 | Руководство |
| +79000009009 | Администратор |
| +79000009101 | Бригадир подрядчиков |
| +79000009102 | Технолог |
| +79000009103 | Специалист |
| +79000009104 | Механик |
| +79000009105 | Электрик |
| +79000009106 | Холодильщик |
| +79000009107 | Сантехник |

После входа нужно выбрать `Завод — мобильный пилот`.

## Безопасность и ограничения

- QR содержит только чистый HTTPS URL, без логина, пароля, token, userId или factoryId.
- Pilot-only аккаунты не имеют доступа к Заводу 4; существующим pilot-pack аккаунтам добавлен только доступ к изолированному pilot factory.
- Quick Tunnel предназначен для временного тестирования, не гарантирует постоянный адрес или uptime.
- Если компьютер выключен, уснул, потерял интернет или cloudflared остановлен, внешний стенд недоступен.
- Камера, микрофон, push, vibration и фактическая установка PWA подтверждаются только на физическом телефоне.

## Evidence

Каждый запуск сохраняет отдельную папку `runtime/<timestamp>/` с build/Prisma/health/E2E результатами и PID. Пароли, access/refresh tokens, `DATABASE_URL`, `passwordHash`, `storagePath` и секреты туда не записываются.
