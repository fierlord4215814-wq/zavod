# Physical Field Fixes V2: evidence по требованиям

Источник: `codex_zavod_physical_field_fixes_v2/REQUIREMENTS_LEDGER.md`. Итоговая сверка: 23.07.2026.

## Сводка

| Статус | Количество |
|---|---:|
| `PROVEN` | 145 |
| `PROVEN_AFTER_FIX` | 157 |
| `SUPERSEDED_FOR_ROUTE / KNOWN_P2` | 3 |
| `PHYSICAL_ONLY / PENDING` | 1 |
| `PARTIAL` | 0 |
| `MISSING` | 0 |
| **Всего** | **306** |

## PROVEN (145)

A01, A02, A03, A04, A05, A06, A07, A08, A09, A11, B03, B10, B11, B12, B13, C02, C03, C07, C08, C10, C15, C16, C19, C22, D06, D07, D08, D10, D11, D13, D14, D15, F04, F05, F08, F09, F10, F15, F16, F20, F21, F22, F23, F24, F26, F27, G02, G03, G04, G06, G08, G09, G10, G11, G12, G14, G15, G16, G20, G21, G22, G23, G24, G25, G28, G29, H03, H10, J01, J02, J03, J06, J07, J08, J09, J14, J15, J18, J19, J20, J21, J22, J23, J24, J27, J28, J30, J32, J33, J34, J35, J36, J37, J38, J39, J40, K01, K07, K08, K09, K11, K12, L01, L02, L06, L21, L22, L23, L25, L26, L27, L29, L30, L31, L32, L33, M01, M02, M03, M04, M05, M06, M07, M08, M09, M10, M11, M12, M13, M14, M15, M20, M21, M22, M23, M24, M25, M26, M29, N15, N16, O01, O11, O12, O16.

## PROVEN_AFTER_FIX (157)

A12, B02, C11, C12, C14, C17, C20, D04, E10, F01, F06, F11, G01, G05, G13, G27, I01, I02, I03, I04, I05, I06, I07, I08, I09, I10, I11, I12, I13, I14, I15, J12, J16, K10, L03, L04, L07, L08, L09, L10, L11, L12, L13, L14, L15, L16, M17, O02, O03, O04, O05, O06, O07, O08, O09, O10, O13, O14, O15, B04, B05, C01, C05, A10, E01, E02, E03, E09, E15, E16, F02, F03, F07, F12, F14, F17, F19, G26, H01, H02, H04, H05, H06, H07, H08, H09, J04, J05, L18, L19, L20, L24, L28, M16, M18, M19, M27, M28, N01, N02, N03, N04, N05, N06, N07, N08, N09, N10, N11, N12, N13, N14, B01, B06, B07, B08, B09, C04, C06, C09, C13, C18, C21, D01, D02, D03, D05, D09, D12, E04, E05, E06, E07, E08, E11, E12, E13, E14, F13, F18, G07, G17, G18, G19, J10, J11, J13, J17, J25, J26, K02, K03, K04, K05, K06, L05, L17.

## SUPERSEDED_FOR_ROUTE / KNOWN_P2 (3)

- `F25`: отдельное поле комментария строки line plan не добавлено. Текущая модель хранит основное плановое назначение, но не отдельный row comment.
- `J29`: отдельный demand contour по конкретной внешней фирме отсутствует.
- `J31`: cross-factory invite/request отсутствует; автоматический доступ ко всем заводам намеренно не выдаётся.

Эти пункты не являются скрытыми `MISSING`: они сознательно вынесены из безопасного route scope, потому что требуют отдельного schema/business решения. Они не блокируют текущий физический пилот основных маршрутов.

## PHYSICAL_ONLY / PENDING (1)

- `O17`: фактическая проверка на физическом телефоне с установленной PWA. Автоматизированный и удалённый HTTPS gates прошли, но физический gate остаётся `PENDING`.

## Карта evidence

| Группа | Что доказано | Основное evidence |
|---|---|---|
| A | reuse canonical contours, отсутствие параллельных модулей | discovery/canonical map, source assertions |
| B-D | Guest, shell, role menu, badges, Back, drafts | Stage 01 report, backend regression, desktop + 360/390/430 E2E |
| E-I | текущая смена, линии, люди, назначения, простои | Stage 02 report, assignment/line/downtime regressions, Stage 02 E2E/screenshots |
| J-K | будущая смена, contractor facts, worker history | Stage 03 report, 32/32 regression, Stage 03 E2E/screenshots, shift boundaries |
| L-N | checklist constructor, runner, lifecycle, home | Stage 04 report, 15/15 regression, checklist gates, Stage 04 E2E/screenshots |
| O | final builds, Prisma, scans, PWA, remote runtime | Stage 05 test evidence, runtime manifest, QR/access document |

## Инварианты

- Backend guard остаётся источником истины.
- Cross-factory, cross-department и cross-company deny проверены прямыми API запросами.
- WORKER/Guest не получают скрытые operational/admin данные.
- Diagnostic fixtures не попадают в обычный runtime.
- Ни один пункт не объявлен физически проверенным без реального устройства.
