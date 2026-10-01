# PHYSICAL FIELD FIXES V5 - Пласт 5: discovery

Дата: 09.08.2026

## Границы

Пласт ограничен объявлениями, повторными напоминаниями и media UX существующих чатов. Линии, назначения, мойка, оттайка, качество, возвраты, Stage68 и общий UI-аудит не открывались. Пласт 4 повторно не проверялся.

## Canonical владельцы

- Объявления: Prisma `Announcement`, `AnnouncementDepartment`, `AnnouncementRead`; `backend/src/modules/announcements/announcements.service.ts`; `frontend/src/screens/AnnouncementsScreen.tsx`.
- Уведомления: существующий `NotificationsService.createOnce`; после commit используются действующие push/WebSocket hooks.
- Периодическое выполнение: существующий lifecycle-паттерн сервисов `OnModuleInit` / `OnModuleDestroy` с минутным interval и обязательным cleanup. Второй scheduler не создан.
- Заводское время: `backend/src/common/shift-time.ts`, зона `Europe/Moscow`; календарные недели и месяцы считаются в factory-local времени.
- Чаты: существующие Prisma `Chat`, `Message`, `ChatMember`, реакции и опросы; `backend/src/modules/chats/chats.service.ts`; `frontend/src/screens/ChatsScreen.tsx`.
- Файлы: единый `Attachment` и guarded endpoints. Стабильный порядок уже задаётся `createdAt ASC`; `storagePath` публично не сериализуется.
- Media viewer: расширен существующий `frontend/src/components/AttachmentPreviewList.tsx`; отдельная gallery model и второе хранилище не создавались.
- Дизайн: canonical Industrial Premium 10F в `frontend/src/styles.css`; новый theme/modal manager не создавался.

## Решение по recurrence

Текущей схеме не хватало устойчивого cursor для следующего напоминания и точной идемпотентности occurrence на получателя. Поэтому доказанно потребовалась одна минимальная additive migration:

- enum `AnnouncementRecurrence`: `NONE`, `WEEKLY`, `BIWEEKLY`, `MONTHLY`;
- поля объявления `recurrence`, `recurrenceAnchorAt`, `nextReminderAt`, `lastReminderAt`;
- nullable unique `Notification.operationId` для точного `createOnce`.

Migration не содержит `DROP`, `TRUNCATE`, `DELETE FROM` или destructive rewrite. Исторические объявления получают совместимый `NONE`.

## Переиспользованные контуры

- одна canonical публикация; occurrence не создаёт копию объявления;
- текущий audience по заводу и отделам вычисляется на момент напоминания;
- `AnnouncementRead` остаётся per-user acknowledgement;
- блокированные, деактивированные, guest и уже ознакомившиеся получатели исключаются;
- существующий notification routing и WebSocket dispatch сохраняются;
- существующие chat send/reply/edit/delete/reaction contracts не менялись;
- изображения остаются обычными `Attachment`, без копий и новых таблиц.

## Не создано

Не создано второго scheduler, notification service, attachment storage, chat service, gallery model, modal manager или дизайн-системы. Миграций для чата и viewer нет.
