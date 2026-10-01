# PHYSICAL FIELD FIXES V5 - Пласт 5: финальный отчёт

Дата: 09.08.2026

## 1. Canonical Announcement owner

Использованы существующие `Announcement`, `AnnouncementDepartment`, `AnnouncementRead`, `AnnouncementsService` и `AnnouncementsScreen`. Копии публикаций для повторений не создаются.

## 2. Новый viewer

Viewer занимает viewport: компактный фиксированный header, центральная страница и фиксированный footer ознакомления. Внешняя карточка не должна вертикально прокручиваться; scroll принадлежит только текстовой странице.

## 3. Photo/text pages

Image attachments идут в существующем порядке вложений, по одному фото на страницу. После последнего фото идёт одна текстовая страница с текстом и компактными non-image файлами. Без фото сразу открывается текст.

## 4. Acknowledgement

Сохранён per-user `AnnouncementRead`, серверный timestamp и идемпотентный повторный submit. Кнопка постоянно доступна в footer; после успеха кратко показывает `✓ Ознакомлен`, блокируется и очередь обновляется. Связанные reminder notifications помечаются прочитанными.

## 5. Recurrence model

Additive schema использует `NONE`, `WEEKLY`, `BIWEEKLY`, `MONTHLY`, anchor и cursor следующего/последнего напоминания. Исторические публикации совместимы через `NONE`.

## 6. Интервалы

Неделя добавляет 7 factory-local календарных дней, две недели - 14. Месяц использует исходный день anchor, корректно ограничивает короткий месяц и возвращается к anchor в следующем длинном месяце.

## 7. Только неознакомившиеся

На каждом occurrence audience вычисляется заново. Исключаются уже ознакомившиеся, guest, blocked, deleted, inactive access и пользователи вне текущего factory/department scope.

## 8. Защита от дублей

Для `announcement + occurrence + recipient` строится стабильный внутренний operation id. Nullable unique `Notification.operationId`, `createOnce` и operation lock оставляют одну запись даже при трёх конкурентных scheduler calls. Retry той же occurrence не создаёт дубль.

## 9. Notification/realtime

Переиспользован `NotificationsService.createOnce` и существующий post-commit push/WebSocket dispatch. Отдельный notification/realtime контур не создавался. Notification routing и WebSocket regression прошли.

## 10. Canonical Chat/Message/Attachment owner

Backend чата не дублировался. Сохранены существующие Chat/Message/Attachment, guarded download, участники, factory/department access, reply/edit/delete/reaction и WebSocket события.

## 11. Image layouts

Расширенный `AttachmentPreviewList` строит 1/2/3/4 tile layouts; для 5+ показывает четыре tile и `+N`. У сообщения остаются один bubble, один author header и один timestamp.

## 12. Fullscreen media

Тот же shared viewer открывает выбранное фото, показывает counter, поддерживает стрелки, swipe и zoom 1-3. Close/Android Back возвращают в тот же message/announcement context без создания копий файлов.

## 13. Participant accent

Для чужих несистемных сообщений цвет выбирается детерминированно из четырёх слабых canonical tokens по `chatId + authorId`. Собственные и системные сообщения сохраняют прежний distinct style.

## 14. Message grouping

Сохранено существующее окно 5 минут: последовательные сообщения одного автора визуально группируются, но каждое сообщение остаётся отдельной сущностью с собственными действиями.

## 15. Chat regression

Проверены text, reply, reaction toggle, own edit/delete, foreign edit deny, voice/video attachments, poll/vote, hidden-chat non-member deny, cross-factory deny, attachment privacy и soft archive. Stage23 отдельно подтвердил factory/own-department list и запрет чужого отдела.

## 16. Backend tests

- `physical-field-fixes-v5:plast5-regression`: PASS, 0 failures.
- `stage24:announcements-regression`: PASS.
- `stage52:fullscreen-announcements-regression`: PASS.
- `stage23:chats-regression`: PASS.
- `chat:mobile-messenger-v1-regression`: 15 passed, 0 failed.
- `notifications:routing-v1-regression`: PASS.
- `realtime:v1-regression`: PASS после замены невалидного fixture `worker-1` (`passwordResetRequired=true`) на активного `worker-2`; guard не менялся.

## 17. Browser evidence

Playwright spec компилируется и перечисляет два проекта (`desktop-edge`, `mobile-360-edge`). Единственная штатная попытка завершилась до запуска тестов: дочерний Vite build получил внешний `Access is denied` при чтении `frontend/vite.config.ts`. Повторных запусков и обходного runtime не было. Visual gates честно имеют `BLOCKED_EXTERNAL_BROWSER_RUNTIME`; screenshots не созданы.

## 18. Cleanup

Финальная read-only matrix: active announcements 0, recurrences 0, accesses 0, departments 0, chats 0 для `__PFFV5_P5_`. Использовались archive/soft-deactivate; pre-existing records не удалялись. `CLEANUP_GATE: PASS`.

## 19. Приоритеты

- P0: 0.
- P1: 0.
- P2: 0 подтверждённых продуктовых дефектов.
- Остался внешний browser evidence blocker, не дефект приложения.

## 20. Изменённые файлы

- `backend/package.json`
- `backend/prisma/schema.prisma`
- `backend/prisma/migrations/20260809120000_physical_field_fixes_v5_plast5_announcements/migration.sql`
- `backend/src/common/shift-time.ts`
- `backend/src/common/operation-lock.ts`
- `backend/src/modules/announcements/announcement-recurrence.ts`
- `backend/src/modules/announcements/announcements.service.ts`
- `backend/src/modules/notifications/notifications.service.ts`
- `backend/src/push/push.service.ts`
- `backend/scripts/physical-field-fixes-v5-plast5-regression.js`
- `backend/scripts/stage23-chats-regression.js`
- `backend/scripts/stage24-announcements-regression.js`
- `backend/scripts/stage52-fullscreen-announcements-regression.js`
- `backend/scripts/realtime-ws-v1-regression.js`
- `frontend/package.json`
- `frontend/src/store/app.store.ts`
- `frontend/src/components/AttachmentPreviewList.tsx`
- `frontend/src/screens/AnnouncementsScreen.tsx`
- `frontend/src/screens/ChatsScreen.tsx`
- `frontend/src/styles.css`
- `frontend/e2e/physical-field-fixes-v5-plast5.spec.ts`
- четыре evidence-файла в `docs/physical-field-fixes-v5-plast5/`.

Compatibility updates в Stage23/24/52 и realtime runner не ослабляют assertions: они сверены с текущими canonical audience, publisher/chat permissions и access lifecycle.

## 21. Итоговые gates

Backend recurrence/idempotency/audience, RBAC, factory isolation, attachment privacy, realtime, builds, Prisma и cleanup: PASS. Viewer/chat visual/mobile gates: `BLOCKED_EXTERNAL_BROWSER_RUNTIME`. Полная матрица находится в `requirement-status.md`.

`FINAL_STATUS: BLOCKED`

Пласт 6 не начинался.
