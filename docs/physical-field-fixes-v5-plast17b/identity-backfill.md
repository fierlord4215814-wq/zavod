# Пласт 17B: canonical identity и backfill

## Canonical owner

Persisted owner: nullable поля `User.lastName`, `User.firstName`, `User.middleName`. Общий presenter `pilotDisplayName` сначала использует canonical fields и только для unresolved users формирует безопасный человекочитаемый fallback. Runtime presentation больше не зависит от pilot dictionary как business authority.

Admin изменяет ФИО в существующем user/access flow. Endpoint ADMIN-only, проверяет выбранный завод и пишет audit без секретных полей. Audit actor/object labels получают имя через тот же presenter.

## Trusted backfill

Миграция заполнила только пять однозначно известных pilot-pack users:

| User key | До | После |
|---|---|---|
| `pilot-pack-admin` | canonical fields отсутствовали | Романов Р. А. |
| `pilot-pack-management` | canonical fields отсутствовали | Алексеева А. Р. |
| `pilot-pack-senior-master` | canonical fields отсутствовали | Беляев Б. С. |
| `pilot-pack-kipia-lead` | canonical fields отсутствовали | Захаров З. К. |
| `pilot-pack-guest` | canonical fields отсутствовали | Громов Г. Г. |

`BACKFILLED_USERS: 5`.

ФИО для остальных пользователей не выдумывалось. Финальный read-only census после marker tests:

- users total: 3574;
- с заполненными фамилией и именем: 11;
- unresolved canonical identity: 3563;
- из 11 resolved шесть относятся к заблокированным marker users browser evidence, пять — trusted backfill выше.

`UNRESOLVED_USERS: 3563`. Для них сохраняется safe fallback; это намеренная data-safety стратегия, а не массовая перезапись реальных данных.

## Consumer proof

Marker user был создан штатным UI/API flow, ФИО изменено и прочитано обратно. Одинаковое canonical отображение доказано для:

- Admin users;
- People и profile card;
- directory name/phone search;
- shift assignment search;
- Chat people search;
- Audit object label.

После доказательства marker users заблокированы, accesses деактивированы, активных marker rows нет. Physical delete не выполнялся.

