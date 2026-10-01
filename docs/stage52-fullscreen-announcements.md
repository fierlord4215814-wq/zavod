# Stage 52 — Полноэкранные объявления и ознакомление

## Discovery result

Модуль объявлений уже существовал: `Announcement`, `AnnouncementSettings`, `AnnouncementRead`, backend controller/service, archive integration и attachment guard для `ANNOUNCEMENT`. Новая таблица для acknowledgement не понадобилась: `AnnouncementRead` уже хранит per-user факт прочтения и теперь используется как “Ознакомлен”.

Не дублировались:

- `AnnouncementsModule`;
- таблицы объявлений;
- attachment foundation;
- архивный раздел.

## Концепция

Объявление — это не чат и не пересменка. Это крупный информационный экран, который сотрудник должен прочитать и подтвердить.

Основной поток:

1. Сотрудник открывает “Объявления”.
2. Видит первое непрочитанное объявление почти на весь экран.
3. Читает текст и вложения.
4. Нажимает “Ознакомлен”.
5. Объявление уходит в его личный архив.
6. Показывается следующее непрочитанное объявление.

Ознакомление одного человека не скрывает объявление для остальных.

## Fullscreen Reading UX

Экран “Новые” показывает одно объявление:

- прогресс “Объявление 1 из N”;
- важность;
- крупный media-блок;
- заголовок;
- автор и роль;
- дата публикации;
- срок действия;
- получатели;
- текст;
- sticky-кнопка “Ознакомлен”.

Если новых объявлений нет, пользователь видит спокойное состояние “Новых объявлений нет” и переход в архив.

## Per-user Acknowledgement

Используется `AnnouncementRead`:

- `announcementId`;
- `userId`;
- `readAt`, в API также отдаётся как `acknowledgedAt`.

`POST /announcements/:id/ack` idempotent: повторное нажатие не создаёт дубль и не перетирает первичное время ознакомления. Старый endpoint `/announcements/:id/read` сохранён для совместимости.

Audit:

- `ANNOUNCEMENT_ACKNOWLEDGED`;
- `ANNOUNCEMENT_READ` для совместимости со старыми проверками.

## Employee Archive

`GET /announcements/archive` возвращает доступные пользователю прочитанные, истёкшие или архивные объявления в его scope. Обычный сотрудник видит только своё состояние:

- “Не ознакомлен”;
- “Ознакомлен дата/время”.

Он не видит журнал других сотрудников.

## Manager Ack Report

`GET /announcements/:id/ack-report` доступен:

- ADMIN;
- автору объявления;
- пользователю с `announcements.manage` в scope;
- пользователю с `announcements.readReport`, если такое право будет заведено.

Отчёт показывает:

- “Ознакомились”;
- “Не ознакомились”;
- ФИО/человекочитаемое имя;
- отдел;
- роль;
- время ознакомления.

Целевая аудитория Stage52 считается по текущему scope объявления: весь завод или выбранный отдел. Ролевые и персональные получатели оставлены future, чтобы не плодить новую модель назначения объявлений.

## Create / Manage

Создание и управление доступны руководящим ролям с `announcements.create` / `announcements.manage`.

Форма содержит:

- заголовок;
- текст;
- важность;
- получателей: весь завод или отдел;
- срок действия;
- вложения фото/видео/файлов;
- простой предпросмотр.

`WORKER`, `CONTRACTOR` и обычные роли без permission не создают объявления.

## Attachments

Используется существующая Stage43/Stage51 attachment foundation:

- фото видны как preview;
- фото открываются в fullscreen viewer;
- видео показываются viewer/player, если браузер поддерживает;
- файлы показываются карточкой;
- `storagePath` не возвращается;
- download/view guarded по видимости объявления.

## RBAC / Scope

Пользователь видит объявление, если:

- оно относится к выбранному заводу или глобальное;
- оно активно и не удалено;
- оно адресовано всему заводу или его отделу;
- пользователь имеет `announcements.read`;
- пользователь не заблокирован.

Cross-factory и blocked users denied. Guest-поведение осталось за существующей настройкой `guestCanRead`; Stage52 не расширяет guest access.

## API

Новые/усиленные endpoints:

- `GET /announcements/current`;
- `GET /announcements/unread`;
- `POST /announcements/:id/ack`;
- `GET /announcements/archive`;
- `GET /announcements/:id/ack-report`.

Старые endpoints сохранены:

- `GET /announcements`;
- `GET /announcements/:id`;
- `POST /announcements`;
- `PATCH /announcements/:id`;
- `POST /announcements/:id/archive`;
- `POST /announcements/:id/read`.

## Security

В API не отдаются:

- `storagePath`;
- `passwordHash`;
- tokens;
- production secrets.

Журнал ознакомления не доступен обычным сотрудникам.

Stage52 также усилил runtime guards: заблокированные или soft-deleted пользователи получают `403` на новых endpoints (`/current`, `/unread`, `/archive`, `/ack`, `/ack-report`) и на совместимом `/read`, а не пустой список. Это важно для pilot/debug прохода: отсутствие объявлений не маскирует реальный запрет доступа.

## Future

- отложенная публикация;
- обязательное повторное ознакомление после изменения;
- экспорт журнала ознакомления;
- персональные получатели;
- role-based recipients;
- push-уведомления для важных объявлений;
- эскалация по непрочитанным обязательным объявлениям.
