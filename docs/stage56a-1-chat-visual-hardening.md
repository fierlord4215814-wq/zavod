# Stage56A.1 — Chat Visual Hardening

## Discovery result

Stage56A уже дал рабочий внутренний мессенджер: `ChatsModule`, `ChatMessage`, `ChatRead`, guarded attachments и `/chats/:id/media` существуют. Новая модель или миграция не потребовались.

Проблемы были во frontend-слое:

- `ChatsScreen` и старые Stage56A проверки содержали mojibake-строки вместо нормального русского текста.
- Фото в ленте отображались как карточка файла, а не как живое preview сообщения.
- Вкладка “Медиа” не давала ощущения сетки, а вкладка “Файлы” могла визуально смешиваться с медиа.
- Composer на телефоне был слишком тяжёлым: picker всегда занимал место под полем сообщения.
- Overlay preview/инфо-панелей требовал более явного слоя поверх мобильной навигации.

## Migration

Миграция не нужна. Существующие `Chat`, `ChatMessage`, `Attachment`, guarded download endpoint и `/chats/:id/media` достаточны.

## Что изменено

- `AttachmentPreviewList` получил режимы:
  - `inline` — фото/видео внутри ленты сообщения;
  - `grid` — сетка медиа во вкладке чата;
  - `list` — обычные файловые карточки.
- Фото в сообщениях открываются в fullscreen viewer через guarded URL `/attachments/:id/file`.
- Файлы остаются карточками с названием, размером и действием “Открыть”.
- Composer в чатах стал компактным: picker открывается по кнопке “Прикрепить файл” и не сбрасывает набранный текст.
- Мобильные overlay получили явный высокий слой и scroll lock.
- Старые Stage56A checks обновлены как compatibility update: они теперь ищут нормальный русский UI и новый compact attachment flow.

## Security / RBAC

Backend guards не менялись. Доступ к сообщению и вложению по-прежнему определяется исходным чатом:

- пользователь видит только доступные чаты;
- non-member не открывает вложение закрытого/direct чата;
- cross-factory denied;
- `storagePath`, `passwordHash`, `token` не возвращаются в chat/media DTO.

## Что не входит

- WebSocket/realtime.
- Реакции, треды и закреплённые сообщения.
- Новое хранилище файлов.
- Физическое удаление вложений.
- Новый чат-модуль.

## Checks

Stage56A.1 добавляет:

- backend regression: `stage56a_1:chat-visual-hardening-regression`;
- browser e2e: `stage56a_1:browser-e2e`;
- screenshots: `docs/stage56a-1-chat-visual-hardening-screenshots`.
