# PHYSICAL FIELD FIXES V5 - Пласт 9: финальный отчёт

Дата: 11.08.2026.

1. Checklist runner стал focused: компактная шапка, прогресс и срок; текущий пункт доминирует над вторичной информацией.
2. Убраны крупные повторяющиеся блоки периодичности/нормы; вторичные действия вынесены в общий `PremiumSheet`.
3. Числовой пункт показывает норму один раз, одно поле значения и результат ниже поля.
4. Необязательный комментарий закрыт по умолчанию и раскрывается явным действием.
5. Пауза стала вторичной; для paused run главным действием является «Возобновить чек-лист».
6. Карточки назначения отдельно показывают позицию, сотрудника/вакансию и статус.
7. Inventory нашёл 13 реальных производственных линий Завода 4.
8. Все 13 уже имели корректный `defaultStaffingTemplateId` и «Утверждённый состав».
9. Staffing reconciliation: 0 изменений данных; read-model теперь использует существующий default fallback.
10. Неоднозначных линий и линий без шаблона: 0.
11. Численность не придумывалась: использованы существующие позиции с итогами 5, 5, 6, 4, 10, 5, 6, 8, 9, 3, 4, 7, 7.
12. Canonical owner отделов: `DirectoryService.canonicalDepartments`, factory-local + настоящий global, LOCAL override.
13. Финальный inventory: 69 активных строк, из них 51 test fixture и 18 легитимных; operational options - 13.
14. Доказанных business-duplicates для merge: 0; LOCAL/GLOBAL пары признаны различными по scope.
15. Мягко деактивированы 2 zero-reference P9 `duplicate-proof` fixtures, созданные ранними прогонами этого блока.
16. References remapped: 0; существующие связи и история сохранены.
17. Ambiguous rows: 0; 51 историческая fixture со связями оставлена нетронутой.
18. Same-factory duplicate предотвращает существующий normalized-name guard; regression проверяет отсутствие записи.
19. «Весь завод» выбирает все активные non-guest доступы текущего завода, не превращаясь в department selection.
20. «Выбрать все / Снять все» работают только внутри режима «Выбранные отделы» и не меняют тип аудитории.
21. Recipient test: один отдел, объединение двух, весь завод и selected-all совпали с точными backend наборами; cross-factory directory denied.
22. PASS: backend/frontend builds, Prisma validate/status, P9 21/21, checklist 80/80 + periodic, announcements P5, privacy 17/17, browser E2E 3/3.
23. Cleanup: active P9 checklist templates 0, runs 0, departments 0; pre-existing entities deleted 0, physical deletes 0.
24. P0: 0. P1: 0. P2: 0. Physical Android recheck остаётся manual/PENDING.
25. Изменены canonical services/screens/styles, два P9 scripts, один P9 E2E, package scripts и этот компактный evidence pack; Prisma schema/migration не менялись.
26. Fresh physical-ready runtime поднят 11.08.2026: backend `PID 16884` (20:40:26 +03:00), frontend `PID 7188` (21:08:24 +03:00), новый Cloudflare Quick Tunnel `PID 19008` (21:14:06 +03:00), keep-awake `PID 9736`; HTTPS URL `https://transition-consequence-adrian-direct.trycloudflare.com`, health `https://transition-consequence-adrian-direct.trycloudflare.com/api/health`, service worker `zavod-shell-v6`, QR `docs/physical-field-fixes-v5-plast9/physical-recheck-qr.png`. Публичный frontend, same-origin API, manifest, service worker и authenticated WSS прошли read-only smoke. Quick Tunnel временный; физический Android gate остаётся `PENDING` до подтверждения пользователя.

Скриншоты находятся в этой папке: runner desktop/360/390/430, assignment card 360 и announcement audience desktop/390.
