# Legacy WashSession reconciliation

## Политика безопасности

- Dry-run является режимом по умолчанию.
- Apply разрешён только для `PROVEN_TEST` и `PROVEN_PILOT_TEST`.
- `POSSIBLE_REAL_USER_DATA` и `VALID_CURRENT_SESSION` автоматически не меняются.
- Нет `delete`, физического удаления вложений, комментариев, проблем, заданий, событий или ОКК-истории.
- Каждая закрытая запись получает `COMPLETE` и audit action `PFFV5_P3_LEGACY_TEST_RECONCILIATION`.
- Операция сериализована по мойке, линии и активным участникам; повторный запуск идемпотентен.

## Результат для Завода 4

Перед apply:

- active: 16;
- доказанные test: 13;
- доказанные pilot-test: 3;
- возможные реальные данные: 0;
- валидные текущие мойки: 0;
- eligible: 16.

Apply:

- закрыто сессий: 16;
- закрыто активных назначений: 0;
- physical delete: 0;
- после apply active: 0.

Повторный dry-run:

- active: 0;
- eligible: 0;
- mutations: 0;
- physical delete: 0.

## Сохранность истории

Read-only сверка по 16 audit-linked сессиям после apply:

- audit records: 16;
- завершённых сессий: 16;
- reconciliation COMPLETE events: 16;
- исходных событий сохранено: 32;
- комментариев сохранено: 5;
- ОКК-записей сохранено: 15;
- вложений сохранено: 1;
- проблем и заданий в этом наборе до apply не было.

Reconciliation изменила только lifecycle доказанных test/pilot сессий и добавила audit/event evidence. Реальные рабочие данные не очищались.
