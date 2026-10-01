# Lines gap resolution

| Gap | Статус | Исправление | Доказательство |
| --- | --- | --- | --- |
| LINE-001 | RESOLVED | Active `DefrostEvent` проецируется как `DEFROST`, выше обычного STOP и отдельно от WASH/DOWNTIME. | Backend audit, browser card/KPI. |
| LINE-002 | RESOLVED | Для DEFROST скрыты line status mutations; доступно только открытие существующего раздела оттайки с его guards. | Browser E2E и screenshots 01-02. |
| LINE-003 | RESOLVED | Удалён role-name bypass. Shift-assignment mutation требует существующую effective manage capability; DENY даёт 403. | Stage41 `25/25`, targeted backend. |
| LINE-004 | RESOLVED | `/lines/shift-overview` следует effective read capability, без второго списка ролей. | TECHNOLOG allow в targeted backend. |
| LINE-005 | RESOLVED | Timeline DTO хранит `downtimeReason`, человекочитаемый label и отдельный `comment`. | Timeline regression `34/34`, screenshot 05. |
| LINE-006 | RESOLVED | Единый backend helper обслуживает Lines, Timeline, Archive и Ops; неизвестный legacy code сохраняет полезный смысл. | Backend audit, Ops smoke. |
| LINE-007 | RESOLVED | Деактивированная линия исключена из active list, но её read-only timeline доступен авторизованному пользователю. | Backend audit и archive smoke. |
| LINE-008 | RESOLVED | Клиент передаёт `expectedVersion`; несовместимые действия с одной версией дают `200 + 409`, same-state retry остаётся idempotent. | Backend audit `41/41`, targeted race. |
| LINE-009 | RESOLVED | Situation и Shift People получают один список причин из `/lines/downtime-reasons`, локального business-словаря нет. | Targeted API + builds. |
| LINE-010 | RESOLVED | Public guard error: «Недостаточно прав для этого действия.»; технические capability codes остаются только во внутреннем audit. | Security/privacy `17/17`. |
| LINE-011 | RESOLVED | Display, duration, datetime input и ISO conversion используют factory/server time, а не timezone устройства. | Moscow/Los Angeles browser parity. |
| LINE-012 | RESOLVED | 409 и network errors видны внутри ActionModal, modal не закрывается, retry ручной, optimistic mutation отсутствует. | Browser E2E, screenshot 04. |
| LINE-013 | RESOLVED | Shared mobile-back закрывает верхний app layer и в browser, и в standalone PWA; проверен также non-Lines sheet. | Browser E2E `31/31`. |
| LINE-014 | RESOLVED | При открытии child action/timeline parent detail приостанавливается; интерактивен один business dialog, затем parent восстанавливается. | Browser E2E, screenshot 06. |
| LINE-017 | RESOLVED | Неверная кнопка «Статистика» переименована в «Текущее состояние» без создания новой аналитики. | Browser E2E. |
| LINE-019 | RESOLVED | Синхронный in-flight lock блокирует повторный tap ещё до React re-render; busy/disabled остаются видимыми. | Один PATCH при двойном tap. |

## Открыто вне scope

- `LINE-015 P2`: для неизменяемых исторических названий нужен отдельный контракт snapshot labels; данные не переписывались.
- `LINE-016 P3`: оставить как отдельный debt item.
- `LINE-018 P3`: оставить как отдельный debt item.

Новых P1/P2 исправления не внесли.

