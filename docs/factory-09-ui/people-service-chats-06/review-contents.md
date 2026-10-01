# Состав итогового review ZIP FACTORY9-06 после продолжения

Новый `review-pack-factory09-service06-resume-20260930.zip` фиксирует **частичный source + disposable SQL-срез** без секретов, DB dump, uploads, cookies, токенов и protected runtime config. Прежний `review-pack-factory09-service06-20260930.zip` оставлен как неизменённая история первого source-среза; актуальный для этого продолжения только resume ZIP. Он содержит:

- `docs/` — отчёт, матрицу actor×factory×action, результаты проверок, SQL receipt и этот состав; актуальные AGENTS/handoff/plan обновлены в репозитории, но целиком не перепакованы;
- `source-after/` — точные текущие owners People/Shift/Chat/WS/attachment и новые адресные tests/допустимый disposable SQL probe;
- `source-before-resume/` — семь точных pre-edit файлов текущего продолжения, побайтно сверенных в защищённой предзаписи перед правкой; новый SQL probe не имеет BEFORE;
- `manifest.sha256` — SHA-256 каждого включённого payload-файла.

`frontend/src/screens/ShiftPeopleScreen.tsx` pre-edit **этого продолжения** сохранён, но pre-edit самого первого source-среза 06 по-прежнему отсутствует и не реконструирован. Предыдущие source-before архивы остаются нетронутыми. Review ZIP не содержит автоматически действующих конфигураций и не является доказательством live-приёмки. Исходный внешний ZIP не распаковывался поверх repo.
