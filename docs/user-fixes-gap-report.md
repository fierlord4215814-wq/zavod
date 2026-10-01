# Пласт 8: отчёт по разрывам пользовательских фиксов

Дата сверки: 18.07.2026. Область: пользовательские контракты Пластов 1--6, ранние стабильные fixes и их общие security/mobile требования.

## Итог

```text
USER_FIXES_SWEEP: PASS_WITH_P2
TOTAL_USER_FIXES: 173
PROVEN: 162
PROVEN_AFTER_FIX: 3
SUPERSEDED: 1
PHYSICAL_ONLY: 7
PARTIAL: 0
MISSING: 0
P0: 0
P1: 0
P2: 4
AUTOMATED_GATE: PASS
PHYSICAL_PHONE_GATE: PENDING
```

## Закрытый разрыв

| Приоритет | Контракт | Причина | Решение | Проверка |
|---|---|---|---|---|
| P2 | Вложения задания из «Людей смены» | `ShiftPeopleScreen` использовал локальную отправку `FormData` вместо общего транспорта вложений. | Экран использует `uploadAttachments('TASK', task.id, files)` из canonical `frontend/src/api/attachments.ts`; локальный цикл удалён. | `pilot-fix:plast1-regression` 24/0, backend/frontend build. |

Этот фикс не меняет запись задания, permissions, API, Prisma, runtime-данные или механизм хранения файлов. Он объединяет уже существующий пользовательский путь с единственным transport-контуром.

## Нет автоматизированных разрывов

- В реестре нет строк `MISSING` или `PARTIAL`.
- Для всех экранов Пластов 1--6 подтверждены desktop и 360 px; соответствующие пакеты дополнительно проверяют 390/430 px там, где форма или плотный экран это требует.
- Проверены factory, department и company isolation, прямые API deny, blocked/deactivated guards, отсутствие публичных внутренних путей хранения и чувствительных значений.
- UI с Telegram-чатом и focused checklist runner не переписывался: для них сохранены специальные существующие варианты.

## Оставшиеся P2

Эти пункты не являются разрывами пользовательского контракта Пласта 8; они унаследованы из независимого adversarial-аудита и не исправлялись ради формального зелёного результата.

1. Две historical RolePermission migrations используют `DELETE` для синхронизации конфигурационных grants. Это не physical delete рабочей истории, но ручная custom-грант прав может потребовать отдельной миграционной стратегии.
2. В `backend/scripts/pilot-pack-v1.js` остаётся второй phone normalizer, только для fixtures.
3. В regression fixtures остаются две historical duplicate-active-wash записи; ordinary runtime их не показывает.
4. В `frontend/src/styles.css` остаются historical literal values, хотя canonical Industrial Premium 10F уже не имеет параллельной темы.

## Не входило в scope

- Физические Android/PWA проверки, камера, микрофон, push/vibration и реальная смена.
- Stage68, Docker, VPN, backup/restore, `.env`, uploads и любые очистки данных.
- Новые модули, RBAC-расширения, миграции и redesign.
