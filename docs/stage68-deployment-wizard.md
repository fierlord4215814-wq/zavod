# Stage68 — Technical Deployment Wizard

## Статус

Добавлен технический слой первого запуска и обслуживания проекта «Завод» после статуса Pilot Ready. Это не новый бизнес-модуль и не мастер настройки предприятия.

## Discovery

В проекте уже были:

- backend и frontend workspaces;
- Prisma migrations и Prisma validate/status scripts;
- backend `/health`;
- Stage68 backup create/validate и restore validation dry-run;
- canonical uploads root через `FILE_STORAGE_ROOT`;
- guarded attachment storage.

Не было найдено:

- production `docker-compose`;
- backend/frontend Dockerfile для эксплуатации;
- локального графического мастера установки;
- root CMD-команд для обычного запуска/остановки/проверки;
- сисадминского runbook для первого запуска.

## Что добавлено

- `docker-compose.production.yml`;
- `backend/Dockerfile.production`;
- `frontend/Dockerfile.production`;
- `frontend/nginx.production.conf`;
- локальный web wizard `setup/zavod-setup.js` + `setup/wizard.html`;
- restore wizard `setup/restore.html`;
- root CMD commands:
  - `Установка Завод.cmd`;
  - `Запуск Завод.cmd`;
  - `Остановка Завод.cmd`;
  - `Проверка Завод.cmd`;
  - `Бэкап Завод.cmd`;
  - `Восстановление Завод.cmd`;
  - `Создать ярлыки Завод.cmd`;
- PowerShell script for desktop shortcuts;
- `README_ДЛЯ_СИСАДМИНА.md`.

## Как работает установка

Мастер установки открывается локально в браузере и проходит шаги:

1. Проверка Docker и Docker Compose.
2. Адрес сервера и порты backend/frontend.
3. Папки PostgreSQL data, uploads, backups, logs.
4. Валидация портов, прав записи и production compose-файла.
5. Проверка доступности Prisma schema и migrations.
6. Создание runtime-конфига, технических секретов и запуск Docker Compose.
7. Проверка backend `/health` и frontend.

Секреты не печатаются в UI и логах. Runtime-папка исключена из git через `.gitignore`.

## Runtime config

По умолчанию:

`setup/runtime`

Файлы:

- `zavod.config.json` — не секретные технические настройки;
- `production.env` — секреты и Docker Compose environment.

Перед перезаписью существующего файла создаётся backup-копия с timestamp.
Если runtime-конфиг уже существует, web wizard требует явный чекбокс-подтверждение перед перезаписью технических настроек.

## Backup

Команда `Бэкап Завод.cmd` создаёт полный эксплуатационный backup:

- PostgreSQL custom dump;
- uploads;
- runtime config;
- `manifest.json`;
- `checksums.sha256`.

Backup является секретным operational artifact.

## Restore

Restore вынесен в отдельный локальный web wizard. Он требует явное слово `ВОССТАНОВИТЬ`, валидирует backup и должен использоваться только как аварийный сценарий.

## Что не добавлялось

- бизнес-мастер создания завода;
- создание ADMIN;
- создание отделов, ролей, линий, пользователей;
- новый продуктовый модуль;
- reset/drop/truncate/delete;
- изменение runtime data;
- изменения схемы БД.

## Known Environment Finding

На текущей машине команда `docker` не найдена в PATH, поэтому реальный Docker deploy здесь не запускался. Wizard и проверка должны показать это понятной ошибкой для сисадмина.
