# FACTORY9-06 — review ZIP readback

- Файл: `review-pack-factory09-service06-20260930.zip`
- Размер: 253 462 байта.
- SHA-256: `51333340534D3C1571B9A865E03A1D45FE0FE47B87C3F13B0AA62397B4537688`.
- Manifest: `manifest.sha256` внутри ZIP; все 27 из 27 payload entries прочитаны заново и совпали по SHA-256. Дополнительных entries нет.
- 17/17 включённых `source-after/` и `docs/` entries побайтно совпали с текущими файлами репозитория после финального обновления ZIP.
- Защищённый DB dump, uploads, config, secrets, token/cookie и raw runtime log не включены.
- Состав/ограничение BEFORE: [review-contents.md](review-contents.md). Пакет доказывает целостность обзора, не live-приёмку.
