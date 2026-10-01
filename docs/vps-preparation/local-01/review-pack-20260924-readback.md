# LOCAL-01 review ZIP receipt — 24.09.2026

- Файл: `review-pack-20260924-local01.zip` (новый; прежние ZIP не перезаписаны).
- Размер: 335909 байт.
- SHA-256: `D8193D7C62BE226BED6B70ED9C3495AC46C18502A163EC0239310F71C806CF9A`.
- 59 entry: четыре изменённых product owners, связанные существующие source/contract tests, C0/C1 browser probes, актуальные plan/report/handoff, поимённая матрица 036 и `review-evidence-20260924.md`.
- После создания ZIP каждая entry заново прочитана из архива, её SHA-256 сопоставлен с исходным файлом: `SHA_MISMATCH=0`.
- Не включены `.env`, секреты, PostgreSQL dumps, uploads, старые пользовательские данные, VM и runtime logs с потенциальными credentials. Безопасный лог результатов — `review-evidence-20260924.md` внутри ZIP.
