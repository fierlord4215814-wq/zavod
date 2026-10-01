# Точные оставшиеся границы и одно следующее задание

## Препятствия безопасному пилоту

Актуализация ATT-AUTH-01 27.09: **ATT-AUTH-ADMIN-GUEST RESOLVED**, [новый live пакет](../att-auth-01/report.md); ниже сохранён исторический before NOTIFY02, а не текущий запрет продолжения.
Актуализация ATT-AUTH-01 27.09: **ATT-AUTH-ORDERS-SCOPE RESOLVED** (включая movement/binding/replay), [authority matrix](../att-auth-01/authority-matrix.md); предложенный ниже пакет теперь выполнен по отдельному допуску, NOTIFY02 historical PARTIAL не переписан.

**ATT-AUTH-ADMIN-GUEST / P1 / PROVEN, не исправлен.** Current `AttachmentsService.assertPermission` в `backend/src/modules/attachments/attachments.service.ts` сначала возвращает для `user.isAdmin`, затем проверяет `user.isGuest`. `UserContextService` может вернуть оба true. Штатный `AdminService.grantFactoryAccess` принимает ADMIN+guest: [real HTTP confirmation](attachment-gap.json), не только SQL fixture. Source заказа и Notifications дают403, metadata и bytes вложения дают200. Значения bytes не экспортированы, записаны размер/SHA. Исходный доступ учебного STORE восстановлен через тот же Admin API.

**ATT-AUTH-ORDERS-SCOPE / P1 / PROVEN, не исправлен.** `OrdersService.departmentVisibilityWhere` допускает все departments/shared только ADMIN. Для active STORE общей OrderRequest и active MANAGEMENT общего MinimumStockItem source GET409, но связанное file GET200. `AttachmentsService.entityFactoryId` для ORDER_REQUEST/MINIMUM_STOCK_ITEM проверяет factory, не тот же department predicate. [Security matrix](security.json): оба конкретных entity/file IDs, текущие guards, foreign factory denied. Это не разрешение расширять доступ к общей позиции; необходимо согласовать file authority с существующим source owner.

Оба owner вне шести разрешённых notification fixes и не являются новым SQL postcommit-loss regression. Поэтому здесь нет незапрошенного guard rewrite. NOTIFY02 в целом PARTIAL, несмотря на PASS долговечности шести событий. Не выдавать новый результат за whole MI-SEC PASS / Pilot Ready.

## Что не является новым блокером долговечности

- J20 `master-domain-contracts.test.js`: прежний отдельный fixture failure `Чаты недоступны`, сохранён в [broad observation](targeted-checks.json). Targeted J18 и затронутые тесты прошли; тест J20 не ослаблялся.
- Source-only риски других notification owners — [inventory](similar-patterns.md), не live FAIL.
- Existing Orders notice navigation открывает раздел, не exact modal; guarded source HTTP проверен отдельно. Task открывает exact modal. В CLOSED notice остаётся исходный текстовый код `ORDERED` — виден на [скриншоте](ui-order-closed-390.png); локализация не менялась, это не blanket UI-quality PASS.
- Shared factory notification — одна строка, её читатели определяются текущими правами. Личная историческая строка может остаться после переназначения, но не предоставляет Task/file access. Recipient policy не переписана.
- Changed payload / publication future-expired-lateACK-global / checklist grace-shared / Range206 / original UI063 /29 dead settings сохранены отдельно.
- Windows native proofs не доказывают Docker volumes, Linux permissions, внешний HTTPS/WSS, reboot VPS; физический телефон не проверялся.

## ОДИН следующий запрос — не исполнен автоматически

**ATT-AUTH-01 — закрыть два live-proven разрыва вложений.**

В canonical work прочитать этот отчёт, `attachment-gap.json`, `security.json`, existing AttachmentsService/UserContext/Admin grant и Orders source predicates. На новой owned copy T1 независимо воспроизвести ADMIN+guest metadata/file200 при source403 и Orders source409/file200. Сначала сохранить before identity. Разрешить минимальные изменения только существующих attachment/current-authority owners и targeted tests: guest denial до ADMIN bypass; единая current factory+department/source проверка для OrderRequest, MinimumStockItem и связанного Movement без параллельной модели разрешений. Если другие entity types требуют более широкого решения — сначала bounded impact, не общий аудит.

Критерии готовности: guest/admin-guest/blocked/deleted/revoked и wrong department/factory получают403/штатный скрывающий ответ без metadata/bytes/storagePath; законные ADMIN/own-department/архивные readers сохраняют доступ; upload/delete не расширяются; stale identity и historical notification не дают source/file права; настоящий HTTP/UI source/file smoke и адресные regressions/57 checksums/strict diff0; TASK_CREATED и шесть NOTIFY02 durable events retained. Main T1 untouched, все временные flags возвращены; один review ZIP/full readback; STOP перед phone/Linux/VPS.

Необходим отдельный допуск именно к **исправлению file guards** и к новой изолированной копии/обратимым ACL fixtures. Поручение NOTIFY02 не расширено до этого пакета. Не создавать пользователей/заводы/role matrix, migrations58, physical delete или внешний deployment.
