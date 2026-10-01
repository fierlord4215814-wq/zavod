# Repo Hygiene

This repository must keep source, migrations, seed data, docs, and intentional assets separate from local runtime output.

Do not commit:

- `.env` or local secrets.
- `node_modules`.
- `backend/dist` and `frontend/dist`.
- Local logs, pid files, and job files.
- Local uploads from dev smoke tests.
- Coverage and tool caches.

Commit intentionally:

- Prisma schema and migration files.
- Source files under `backend/src` and `frontend/src`.
- Seed files when they define safe, idempotent starter configuration.
- Docs under `docs`.
- `.env.example` templates without secrets.

Before commit:

1. Run `git status --short`.
2. Ignore generated artifacts in the review.
3. Verify `.env` values are not staged.
4. Verify local upload files are not staged.
5. Run the project checks listed in the current stage report.

On this Windows workspace Git may not be on the default PATH. Visual Studio Git is available at:

`C:\Program Files\Microsoft Visual Studio\2022\Community\Common7\IDE\CommonExtensions\Microsoft\TeamFoundation\Team Explorer\Git\cmd\git.exe`
