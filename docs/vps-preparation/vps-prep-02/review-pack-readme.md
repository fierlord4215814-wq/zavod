# VPS-PREP-01 + VPS-PREP-02 — пакет для ревью

Этот архив содержит реальные текущие исходники и тесты, а не ссылки на локальный workspace. Корень архива повторяет относительные пути проекта. `review-manifest.json` содержит SHA256 и размер каждого вложенного файла; архив после сборки прочитан повторно и сверен с manifest.

Состав: очищенный production build context (manifest/lock, приложение, Prisma schema и вся цепочка SQL migrations), затронутые setup/test owners, dev-only `backend/prisma/seed.js` исключительно для анализа его исключения из runtime, PREP-01/02 отчёты, адресные before/after hashes, первичные сохранённые логи, expected→actual, operator runbook и pending runtime cases. Рабочие `.env`, uploads, БД, backup dumps, node_modules, VM/ISO и персональные артефакты не включены.

`docs/vps-preparation/vps-prep-02/review-diff-checkpoint-to-current.patch` — реальный текстовый `git diff --no-index` выбранных 40 source/test paths. Его база — проверенный кодовый checkpoint 22.09.2026, поэтому он показывает совокупную дельту PREP-01+02; отдельные PREP-02 before-hashes фиксируют состояние непосредственно перед этим этапом. Пути `before/` и `after/` в diff относятся к временным сравнительным деревьям, не к checkout reviewer-а. Это материал ревью, не команда автоматического применения патча.

Проверки с PostgreSQL, Docker Engine и VPS не выполнялись из-за отсутствия разрешённого disposable runtime. Состояние: `PARTIAL_PENDING_RUNTIME_PROOF`; подробности — `docs/vps-preparation/vps-prep-02/pending-runtime.md`. Публичный доступ до HTTPS-этапа запрещён.
