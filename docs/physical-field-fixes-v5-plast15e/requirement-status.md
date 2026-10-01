# Пласт 15E — Requirement status

Дата финальной проверки: 26.08.2026.

| Gate | Статус | Доказательство |
|---|---|---|
| XLSX_REAL_FILE_GATE | PASS | Два реальных `.xlsx` скачаны браузером |
| XLSX_BROWSER_DOWNLOAD_GATE | PASS | Playwright Edge: checklists mobile 360 + requests desktop |
| XLSX_OPEN_GATE | PASS | ExcelJS, artifact reader и Microsoft Excel 14.0 открыли файлы |
| XLSX_FILTER_PARITY_GATE | PASS | UI total равен `X-Archive-Primary-Count` и primary rows |
| XLSX_ALL_PAGES_GATE | PASS | Chunked canonical reads, нет лимита 5000, row-limit split проверен |
| XLSX_FACTORY_SCOPE_GATE | PASS | Заводской scope и cross-factory deny в regression |
| XLSX_RBAC_GATE | PASS | Guest/worker deny; ADMIN allowed; backend guard сохранён |
| XLSX_FIXTURE_VISIBILITY_GATE | PASS | Normal Archive и XLSX используют один fixture visibility contract |
| XLSX_HUMAN_HEADERS_GATE | PASS | Русские доменные headers для 11/11 категорий |
| XLSX_HUMAN_LABELS_GATE | PASS | Имена линий, отделов и пользователей, без UUID как UI |
| XLSX_NO_JSON_DUMP_GATE | PASS | Domain tables, JSON в ячейки не выгружается |
| XLSX_NO_INTERNAL_IDS_GATE | PASS | Workbook scan на UUID/internal paths чистый |
| XLSX_FORMULA_INJECTION_GATE | PASS | Formula-like текст остаётся строкой; formulas/macros = 0 |
| CHECKLIST_TEMPLATE_FILTER_GATE | PASS | Historical selector включает доступный неактивный шаблон |
| CHECKLIST_ONE_TEMPLATE_ONE_TABLE_GATE | PASS | `Пицца мясная`: один основной лист |
| CHECKLIST_MULTI_TEMPLATE_ONE_WORKBOOK_GATE | PASS | Сводка + A/B/C + Параметры в одном workbook |
| CHECKLIST_OCCURRENCE_ROW_GATE | PASS | Одна строка на occurrence |
| CHECKLIST_ANSWERS_AS_COLUMNS_GATE | PASS | Union вопросов snapshot/revision сформирован как колонки |
| CHECKLIST_NUMERIC_CELL_GATE | PASS | NUMBER answers открываются typed numeric |
| CHECKLIST_REVISION_UNION_GATE | PASS | Новые/старые вопросы не теряются; версия указана |
| REQUESTS_ONE_TABLE_GATE | PASS | Все выбранные заявки в одном листе `Заявки` |
| REQUESTS_RELATED_SHEETS_GATE | PASS | Comments/history/attachments добавляются в тот же workbook при наличии |
| ALL_11_ARCHIVE_CATEGORIES_XLSX_GATE | PASS | Backend contract: 11/11 |

## Фактические результаты

- Backend P15E regression: `148 passed, 0 failed`; sections `11/11`.
- Browser E2E: `2 passed`; mobile 360 без horizontal overflow и desktop.
- Controlled checklist: 3 occurrences, вопросы как колонки, revision union, numeric answers.
- Live browser checklist: `Пицца мясная`, 7 occurrences, sheets `Пицца мясная` + `Параметры`.
- Controlled requests: 3 records; live filtered export: 1/1 record, sheets `Заявки`, `Комментарии`, `История`, `Параметры`.
- Microsoft Excel 14.0: даты/время и `[h]:mm` отображаются человекочитаемо; файлы не требуют восстановления.
- Backend build, frontend build, Prisma validate/status, script syntax и package JSON: PASS.
- Migration: `NOT_REQUIRED`; 52 migrations, schema up to date.
- DB created: `0`; DB mutated: `0`; physical delete: `0`.
- P0: `0`; P1: `0`; P2: `0`.
