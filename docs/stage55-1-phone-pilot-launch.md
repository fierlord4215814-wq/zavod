# Stage55.1 — Phone Pilot Launch

Дата проверки: 2026-06-01.

## Назначение

Stage55.1 не добавляет новый модуль. Цель этапа — поднять текущую версию «Завода» локально, проверить минимальный mobile smoke и оставить backend/frontend работающими для ручного просмотра на телефоне.

## Запуск

Backend:

```powershell
cd C:\Users\79164\Documents\work\backend
node dist/main.js
```

Health:

```text
http://127.0.0.1:3000/health
```

Frontend для локального браузера и телефона:

```powershell
cd C:\Users\79164\Documents\work
$env:VITE_API_URL='http://192.168.0.102:3000'
npm.cmd run dev --workspace frontend -- --host 0.0.0.0 --port 5173
```

Локальный URL:

```text
http://127.0.0.1:5173/
```

LAN URL для телефона:

```text
http://192.168.0.102:5173/
```

Телефон должен быть в той же Wi-Fi сети. Если LAN URL не открывается, сначала проверить VPN/Windows Firewall: приложение слушает `0.0.0.0:3000` и `0.0.0.0:5173`, но локальный запрос на LAN-IP с этой машины уходит через VPN-интерфейс и таймаутит.

## Роли для ручного входа

- `test-master` — мастер.
- `pilot-worker-1` / «Тестовый работник 1» — рабочий.
- `test-admin` — администратор.
- `test-okk` — ОКК.
- `test-store` — кладовщик.
- `test-tech-holod` — холодильная служба.

## Mobile Smoke

Проверены и сохранены свежие screenshots:

- `docs/stage55-1-phone-pilot-launch-screenshots/01-mobile-shift-current.png`
- `docs/stage55-1-phone-pilot-launch-screenshots/02-mobile-shift-next.png`
- `docs/stage55-1-phone-pilot-launch-screenshots/03-mobile-assignment.png`
- `docs/stage55-1-phone-pilot-launch-screenshots/04-mobile-line-stats.png`
- `docs/stage55-1-phone-pilot-launch-screenshots/05-mobile-people-profile.png`
- `docs/stage55-1-phone-pilot-launch-screenshots/06-mobile-stock.png`
- `docs/stage55-1-phone-pilot-launch-screenshots/07-mobile-chat.png`
- `docs/stage55-1-phone-pilot-launch-screenshots/08-mobile-announcements.png`
- `docs/stage55-1-phone-pilot-launch-screenshots/09-mobile-checklists.png`
- `docs/stage55-1-phone-pilot-launch-screenshots/10-mobile-admin.png`

## Что проверено

- Backend health отвечает.
- Frontend открывается локально.
- Смена: текущая / следующая / будущие / прошлые читаются на 360px.
- Назначение: slot-to-person flow видим и не перекрыт нижней навигацией.
- Линии: статистика линии открывается.
- Профиль сотрудника: человекочитаемые данные.
- Остатки: мобильная карточка читаема.
- Чаты: мобильный messenger view читаем.
- Объявления: fullscreen announcement view читаем.
- Чек-листы: guided-run отображается как один пункт.
- Админка: роли/права не разваливаются на mobile.

## Проверки

Пройдены:

- `stage55:mobile-pilot-polish-regression`
- `stage55:browser-e2e`
- `stage54:final-visual-pilot-audit-regression`
- `stage54:browser-e2e`
- `stage30:release-readiness-regression`
- `backend build`
- `frontend build`
- `prisma validate`
- `prisma generate`
- `prisma migrate status`
- `node --check backend/prisma/seed.js`
- prompt/alert/confirm scan
- mojibake scan
- visible-English targeted scan

## Что смотреть на реальном телефоне

1. Открыть `http://192.168.0.102:5173/`.
2. Войти как `test-master`, выбрать «Завод 4».
3. Проверить «Смена»: текущая смена, следующая смена, назначение в слот, статистика линии.
4. Войти как `pilot-worker-1`, проверить «Я буду», объявления, чаты и чек-листы.
5. Войти как `test-okk`, проверить форму ОКК и вложения.
6. Войти как `test-store`, проверить остатки и списание.
7. Войти как `test-admin`, проверить выбранный завод, пользователей с доступом, роли/права и настройки модулей.

## Известное сетевое замечание

Сервисы слушают все интерфейсы. Проверка через `127.0.0.1` успешна. Проверка LAN URL с этой же машины дала timeout, потому что Windows отправляет запрос через VPN-интерфейс `10.8.1.1`. Для телефона основной риск не в приложении, а в сетевом доступе: VPN, firewall или изоляция Wi-Fi клиента.
