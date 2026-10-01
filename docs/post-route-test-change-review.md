# Test and fixture change review: Пласты 1-6

Дата: 18.07.2026.

## Метод

В текущем repository snapshot большинство новых route scripts/specs не отслеживается Git (`??`), поэтому полноценного сравнения с историческим commit baseline нет. Review выполнен по исходным файлам Пластов 1-6, `docs/pilot-fix-route-progress.md`, текущему продукт-коду, прямым API guards и фактическому поведению fixtures.

Ни один assertion не менялся только ради зелёного результата. Каждое изменение ниже привязано к доказанному продуктовому контракту.

## Изменения, усиливающие проверки

| Файл | Изменение | Почему не ослабляет тест |
|---|---|---|
| `pilot-fix-plast3-regression.js` | direct legacy TIME API обязан вернуть 409, active Assignment не появляется | закрывает найденный parallel write path |
| `stage13-checklists-regression.js` | diagnostics запрашиваются явно | ordinary runtime остаётся скрытым |
| `stage65-checklist-final-polish-regression.js` | ordinary/diagnostic assertions разделены, templates архивируются штатно | предотвращает новый fixture leak |
| `pilot-fix-plast5-regression.js` | marker-bound orders читаются только explicit diagnostics | product factory/department assertions сохранены |
| `access-lifecycle-v1-regression.js` | list fixture hiding + direct old/new department chat `200/403` | проверяет реальный backend guard точнее прежнего поиска marker ID в списке |
| `v1-pilot-data-role-audit-regression.js` | STORE stock = 403; stock hygiene под MANAGEMENT | соответствует буквальной матрице Пластов 2/5 |
| `pilot-fix-plast1.spec.ts` | реальный pilot token login вместо transient dev Guest bootstrap | browser smoke ближе к production auth |
| `shift-handover-summary.spec.ts` | diagnostic factory виден только тестовому page route; factory header проверяется | не открывает fixture ordinary runtime |

## Compatibility updates

| Область | Старое ожидание | Подтверждённый контракт | Решение |
|---|---|---|---|
| Guest announcements | Guest мог читать | Guest не получает объявления | fixtures ожидают backend 403 |
| STORE stock/orders | STORE мог читать/управлять | Пласт 2/5: только returns, без stock/orders | negative assertions |
| Diagnostic factories/chats/lines | marker entity искалась в ordinary list | marker entities скрыты runtime hygiene | list скрыт, direct scope проверен отдельно |
| Handover время | browser мог передавать смену всегда | только DAY 18-20 / NIGHT 06-08 | backend real regression + deterministic UI route |
| Handover состав | старые тяжёлые категории | lines + continuing wash + linked open downtime task | точные current headings/assertions |
| Checklist ISSUE | число вне диапазона = 409 | значение сохраняется как ISSUE | Stage44/50/63 проверяют новый статус |
| Plast3 mobile nav | только `.bottom-nav` | shell использует также `.mobile-quick-nav` | helper поддерживает оба canonical container |
| Plast4 defrost fixture | тест мог закрыть чужую активную оттайку | duplicate active guard обязателен | выбирается безопасная fixture line |
| Plast6 analytics | implicit diagnostic data | ordinary runtime скрыт | Stage40b включает diagnostics явно |

## Независимый прогон

- Backend Пласты 1-6: PASS.
- Browser Пласты 1-6: `4/4`, `2/2`, `12/12`, `8/8`, `8/8`, `6/6`.
- Privacy: `17/0`.
- Handover: `56/0`; browser desktop/mobile PASS.
- Access lifecycle: PASS, включая blocked/revoke/department direct API.
- Live role change: backend + desktop/mobile PASS.
- Concurrency: `7/0`.
- Data-role audit: `122/1 warning/0 failed`.

## Остаточные ограничения тестов

- Physical hardware нельзя эмулировать доказательно.
- Browser handover UI моделирует открытое временное окно; реальное серверное окно проверяется backend regression с явными boundary timestamps.
- Старые route scripts не имеют Git baseline в текущем snapshot, поэтому review опирается на requirement-to-code evidence, а не на commit diff.
- Diagnostic query mode остаётся доступен только через явный параметр и не отменяет permission/factory scope; ordinary UI его не включает.

Итог: доказательств умышленного ослабления security assertions ради PASS не найдено.
