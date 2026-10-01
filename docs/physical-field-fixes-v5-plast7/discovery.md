# PHYSICAL FIELD FIXES V5 - Пласт 7: bounded discovery

## Browser runtime

Единственная штатная попытка успешна: backend `/health` отвечает, Vite на `127.0.0.1:5173` отдаёт HTTP 200, Codex In-app Browser открыл интерфейс на 390 px.

## Подтверждённые line/human UI разрывы

- Глобальный action смешивал два смысла: `Запустить / вернуть в работу`.
- На экране смены использовалось общее `Запустить линию` вместо `Запустить новую линию`.
- Compact detail остановленной линии не показывал последнее human-событие и не давал доступного действия `Вернуть в работу` внутри detail.
- Backend уже содержит canonical timeline presenter и actor scope; второй presenter не нужен.

## Переиспользуемые контуры

- `LineService`, его dashboard/timeline read models и существующие line commands.
- `SituationScreen.tsx` и `ShiftPeopleScreen.tsx`.
- `PremiumSheet`, существующие modal/back contracts, `useBodyScrollLock`, safe-area tokens и Industrial Premium styles.
- Существующие announcement viewer, chat gallery/fullscreen и partial-release components Пластов 4-6 используются только как verification consumers.

## Migration и границы

Migration не нужна. Prisma schema, guards, line business commands, assignment services, notification/chat/quantity models и данные не меняются. Исправления ограничены human read-model и wording/route binding.
